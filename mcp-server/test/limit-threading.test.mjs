/**
 * limit threading + normalization, end to end, against a real (local) HTTP server.
 *
 * Sibling to top-n-threading.test.mjs (find_skills), but the wire shape is a GET with
 * query params, not a POST body — mirroring skillfed.io's actual
 * `GET /api/packages/search.json?q=...&limit=...` contract (verified live 2026-08-14).
 *
 * The stub always returns MORE candidates than were asked for and includes a `score`
 * field on each, which is what makes both assertions meaningful: a passing truncation
 * count could otherwise just be the server's, and a passing "no score" assertion could
 * otherwise just be the stub never having sent one.
 *
 * Import order matters: packagesClient.mjs reads SKILLFED_PACKAGES_ENDPOINT and
 * findPackages.mjs reads SKILLFED_PKG_LIMIT, both at module load, so the server has to be
 * listening and the env set before the first (dynamic) import.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const OVER_SUPPLY = 30; // > LIMIT_MAX, so the client must be the one truncating
const seen = [];

function stubCandidate(i) {
  return {
    id: `zz-stub-pkg-${i}`,
    name: `zz-stub-pkg-${i}`,
    score: 0.033 - i / 10000, // present on every candidate — normalize() must drop it
    capability: "stub capability",
    worth_installing: "Yes, for testing.",
    license_treatment: "permissive",
    tier: "top_5000",
    page_url: `https://skillfed.io/packages/zz-stub-pkg-${i}`,
    md_url: `https://skillfed.io/packages/zz-stub-pkg-${i}.md`,
    json_url: `https://skillfed.io/api/packages/zz-stub-pkg-${i}.json`,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  seen.push({ pathname: url.pathname, query: Object.fromEntries(url.searchParams) });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      query: url.searchParams.get("q") || "",
      limit: Number(url.searchParams.get("limit")) || 10,
      count: OVER_SUPPLY,
      candidates: Array.from({ length: OVER_SUPPLY }, (_, i) => stubCandidate(i)),
    })
  );
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

process.env.SKILLFED_PACKAGES_ENDPOINT = `http://127.0.0.1:${port}`;
delete process.env.SKILLFED_PKG_LIMIT;

const { findPackages } = await import("../findPackages.mjs?wire=default");

after(() => {
  server.close();
});

const wish = (over = {}) => ({
  name: "SECRET-WISH-NAME",
  description: "parse yaml config",
  keywords: ["yaml", "config"],
  ...over,
});

/** Run one search and return {wire, echo, count} for the single wish. */
async function run(mod, input) {
  seen.length = 0;
  const res = await mod.findPackages(input);
  assert.equal(seen.length, 1, "exactly one GET per wish");
  assert.equal(seen[0].pathname, "/api/packages/search.json");
  assert.equal(res.results[0].error, null, `search errored: ${res.results[0].error}`);
  return {
    wire: Number(seen[0].query.limit),
    echo: res.limit,
    count: res.results[0].candidates.length,
  };
}

test("default: 10 on the wire, 10 echoed, 10 kept out of 30 returned", async () => {
  const got = await run({ findPackages }, { wishlist: [wish()] });
  assert.deepEqual(got, { wire: 10, echo: 10, count: 10 });
});

test("a per-call limit reaches the wire AND the truncation", async () => {
  for (const n of [1, 4, 12, 25]) {
    const got = await run({ findPackages }, { wishlist: [wish()], limit: n });
    assert.deepEqual(got, { wire: n, echo: n, count: n }, `limit: ${n}`);
  }
});

test("an out-of-range per-call limit is clamped BEFORE the wire", async () => {
  const high = await run({ findPackages }, { wishlist: [wish()], limit: 99 });
  assert.notEqual(high.wire, 99);
  assert.deepEqual(high, { wire: 25, echo: 25, count: 25 });

  const low = await run({ findPackages }, { wishlist: [wish()], limit: 0 });
  assert.notEqual(low.wire, 0);
  assert.deepEqual(low, { wire: 1, echo: 1, count: 1 });
});

test("SKILLFED_PKG_LIMIT=3 threads through as 3", async () => {
  process.env.SKILLFED_PKG_LIMIT = "3";
  const m = await import("../findPackages.mjs?wire=3");
  delete process.env.SKILLFED_PKG_LIMIT;
  assert.deepEqual(await run(m, { wishlist: [wish()] }), { wire: 3, echo: 3, count: 3 });
});

test("every wish gets its own request, all at the same resolved limit", async () => {
  seen.length = 0;
  const res = await findPackages({ wishlist: [wish(), wish(), wish()], limit: 6 });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map((s) => Number(s.query.limit)), [6, 6, 6]);
  assert.equal(res.n_wishes, 3);
  for (const r of res.results) assert.equal(r.candidates.length, 6);
});

test("privacy floor: only q and limit cross, and never the wish name", async () => {
  seen.length = 0;
  await findPackages({ wishlist: [wish({ keywords: ["yaml", "config", "toml"] })], limit: 5 });
  const sentQuery = seen[0].query;
  assert.deepEqual(Object.keys(sentQuery).sort(), ["limit", "q"]);
  assert.match(sentQuery.q, /parse yaml config/);
  assert.match(sentQuery.q, /yaml/);
  assert.match(sentQuery.q, /toml/);
  assert.equal(sentQuery.q.includes("SECRET-WISH-NAME"), false, "the wish `name` must stay local");
});

test("normalization drops score and keeps exactly the documented fields", async () => {
  const res = await findPackages({ wishlist: [wish()], limit: 2 });
  const [c] = res.results[0].candidates;
  assert.deepEqual(Object.keys(c).sort(), [
    "capability",
    "id",
    "json_url",
    "license_treatment",
    "md_url",
    "name",
    "page_url",
    "tier",
    "worth_installing",
  ]);
  assert.equal("score" in c, false, "score must never be surfaced");
});
