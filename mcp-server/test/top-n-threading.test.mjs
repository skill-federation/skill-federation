/**
 * top_n threading, end to end, against a real (local) HTTP server.
 *
 * The unit test next door proves the clamp; this one proves the clamped value actually
 * reaches BOTH places it has to: the wire payload and the client-side truncation. They used
 * to be two independent module-level constants, so a per-call top_n could change one and not
 * the other, and nothing would notice.
 *
 * The stub always returns MORE candidates than were asked for, which is what makes the
 * truncation assertion meaningful — a passing count could otherwise just be the server's.
 *
 * Import order matters: federation.mjs reads SKILLFED_ENDPOINT at module load and
 * findSkills.mjs reads SKILLFED_TOP_N at module load, so the server has to be listening and
 * the env set before the first (dynamic) import. Per-env-permutation imports cache-bust the
 * specifier; federation.mjs stays cached on purpose, since the endpoint never changes.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const OVER_SUPPLY = 30; // > REMOTE_TOP_N_MAX, so the client must be the one truncating
const seen = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      /* recorded as {} — the assertions will say so */
    }
    seen.push({ url: req.url, raw: body, body: parsed });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        query_id: "q_stub",
        candidates: Array.from({ length: OVER_SUPPLY }, (_, i) => ({
          skill_id: `zz-stub/skill-${i}`,
          name: `zz-stub-skill-${i}`,
          description: "stub",
          score: 1 - i / 100,
          trust: { license: "MIT", provenance: "verified" },
          source_url: "https://example.invalid/zz",
        })),
        confidence: 0.5,
      })
    );
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

// An empty sandbox for the local-skill scan: installedSkillNames() reads ~/.claude/skills,
// so without this the developer's own installed skills could filter stub candidates away.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skillfed-topn-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;
process.env.CLAUDE_PROJECT_DIR = sandbox;
process.env.SKILLFED_ENDPOINT = `http://127.0.0.1:${port}`;
process.env.SKILLFED_TENANT = "test-tenant";
delete process.env.SKILLFED_TOP_N;

const { findSkills } = await import("../findSkills.mjs?wire=default");

after(() => {
  server.close();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const wish = (over = {}) => ({
  name: "SECRET-WISH-NAME",
  description: "audit a site for technical SEO",
  keywords: ["seo", "audit"],
  formulations: ["structured data review"],
  ...over,
});

/** Run one search and return {wire, echo, count} for the single wish. */
async function run(mod, input) {
  seen.length = 0;
  const res = await mod.findSkills(input);
  assert.equal(seen.length, 1, "exactly one /search per wish");
  assert.equal(seen[0].url, "/search");
  assert.equal(res.results[0].error, null, `search errored: ${res.results[0].error}`);
  return { wire: seen[0].body.top_n, echo: res.top_n, count: res.results[0].candidates.length };
}

test("default: 10 on the wire, 10 echoed, 10 kept out of 30 returned", async () => {
  const got = await run({ findSkills }, { wishlist: [wish()] });
  assert.deepEqual(got, { wire: 10, echo: 10, count: 10 });
});

test("a per-call top_n reaches the wire AND the truncation", async () => {
  for (const n of [1, 4, 12, 25]) {
    const got = await run({ findSkills }, { wishlist: [wish()], top_n: n });
    assert.deepEqual(got, { wire: n, echo: n, count: n }, `top_n: ${n}`);
  }
});

test("an out-of-range per-call top_n is clamped BEFORE the wire, never sent raw", async () => {
  const high = await run({ findSkills }, { wishlist: [wish()], top_n: 99 });
  assert.notEqual(high.wire, 99, "99 on the wire would 422 the whole search");
  assert.deepEqual(high, { wire: 25, echo: 25, count: 25 });

  const low = await run({ findSkills }, { wishlist: [wish()], top_n: 0 });
  assert.notEqual(low.wire, 0, "0 on the wire would 422 the whole search");
  assert.deepEqual(low, { wire: 1, echo: 1, count: 1 });
});

test("SKILLFED_TOP_N=3 threads through as 3", async () => {
  process.env.SKILLFED_TOP_N = "3";
  const m = await import("../findSkills.mjs?wire=3");
  delete process.env.SKILLFED_TOP_N;
  assert.deepEqual(await run(m, { wishlist: [wish()] }), { wire: 3, echo: 3, count: 3 });
});

test("SKILLFED_TOP_N=50 no longer breaks the search — it lands as 25", async () => {
  process.env.SKILLFED_TOP_N = "50";
  const m = await import("../findSkills.mjs?wire=50");
  delete process.env.SKILLFED_TOP_N;
  const got = await run(m, { wishlist: [wish()] });
  assert.notEqual(got.wire, 50, "the regression: 50 reached the wire and 422'd every search");
  assert.deepEqual(got, { wire: 25, echo: 25, count: 25 });
});

test("every wish gets its own request, all at the same resolved top_n", async () => {
  seen.length = 0;
  const res = await findSkills({ wishlist: [wish(), wish(), wish()], top_n: 6 });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map((s) => s.body.top_n), [6, 6, 6]);
  assert.equal(res.n_wishes, 3);
  for (const r of res.results) assert.equal(r.candidates.length, 6);
});

test("privacy floor: only the abstracted query crosses, and never the wish name", async () => {
  seen.length = 0;
  await findSkills({
    wishlist: [
      wish({
        sketch: { domain_vocab: ["schema.org"], purpose: "check markup" },
      }),
    ],
    top_n: 5,
  });
  const sent = seen[0].body;
  assert.deepEqual(Object.keys(sent).sort(), ["keywords", "tenant", "top_n", "wish"]);
  assert.equal(
    seen[0].raw.includes("SECRET-WISH-NAME"),
    false,
    "the wish `name` is display-only and must stay local"
  );
  // the wire `wish` is description + formulations + flattened sketch, space-joined
  assert.match(sent.wish, /audit a site for technical SEO/);
  assert.match(sent.wish, /structured data review/);
  assert.match(sent.wish, /schema\.org/);
  assert.deepEqual(sent.keywords, ["seo", "audit"]);
});
