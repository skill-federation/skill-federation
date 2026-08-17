/**
 * limit threading + normalization + confidence/note passthrough, end to end, against a real
 * (local) HTTP server.
 *
 * Sibling to limit-threading.test.mjs (find_packages), but the stub also carries the
 * `confidence`/`note` fields find_research must pass through — and the extra assertions here
 * check that surfacing, since it's the whole point of the tool (a silently-dropped `confidence`
 * would let a weak match read as a confident one).
 *
 * The stub always returns MORE candidates than were asked for and includes a `score` field on
 * each, which is what makes the truncation and "no score" assertions meaningful: a passing
 * truncation count could otherwise just be the server's, and a passing "no score" assertion
 * could otherwise just be the stub never having sent one.
 *
 * Import order matters: researchClient.mjs reads SKILLFED_RESEARCH_ENDPOINT and findResearch.mjs
 * reads SKILLFED_RESEARCH_LIMIT, both at module load, so the server has to be listening and the
 * env set before the first (dynamic) import.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const OVER_SUPPLY = 30; // > LIMIT_MAX, so the client must be the one truncating
const seen = [];
let nextConfidence = "strong"; // toggled per-test via a query-string switch below
let nextNote = undefined;

function stubCandidate(i) {
  return {
    id: `2600.0000${i}`,
    score: 0.033 - i / 10000, // present on every candidate — normalize() must drop it
    paper_title: `Stub Paper ${i}`,
    claim_title: `Stub claim ${i}`,
    meta_description: `Stub description for candidate ${i}.`,
    authors_short: "Stub et al.",
    pub_month_year: "January 2026",
    date: "2026-08-16",
    concept_terms: ["stub concept"],
    page_url: `https://skillfed.io/research/stub-paper-${i}`,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  seen.push({ pathname: url.pathname, query: Object.fromEntries(url.searchParams) });
  res.writeHead(200, { "content-type": "application/json" });
  const body = {
    query: url.searchParams.get("q") || "",
    limit: Number(url.searchParams.get("limit")) || 10,
    count: OVER_SUPPLY,
    confidence: nextConfidence,
    candidates: Array.from({ length: OVER_SUPPLY }, (_, i) => stubCandidate(i)),
  };
  if (nextNote !== undefined) body.note = nextNote;
  res.end(JSON.stringify(body));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

process.env.SKILLFED_RESEARCH_ENDPOINT = `http://127.0.0.1:${port}`;
delete process.env.SKILLFED_RESEARCH_LIMIT;

const { findResearch } = await import("../findResearch.mjs?wire=default");

after(() => {
  server.close();
});

const wish = (over = {}) => ({
  name: "SECRET-WISH-NAME",
  description: "automatic curriculum generation",
  keywords: ["curriculum", "difficulty"],
  ...over,
});

/** Run one search and return {wire, echo, count} for the single wish. */
async function run(mod, input) {
  seen.length = 0;
  const res = await mod.findResearch(input);
  assert.equal(seen.length, 1, "exactly one GET per wish");
  assert.equal(seen[0].pathname, "/api/research/search.json");
  assert.equal(res.results[0].error, null, `search errored: ${res.results[0].error}`);
  return {
    wire: Number(seen[0].query.limit),
    echo: res.limit,
    count: res.results[0].candidates.length,
  };
}

test("default: 10 on the wire, 10 echoed, 10 kept out of 30 returned", async () => {
  nextConfidence = "strong";
  nextNote = undefined;
  const got = await run({ findResearch }, { wishlist: [wish()] });
  assert.deepEqual(got, { wire: 10, echo: 10, count: 10 });
});

test("a per-call limit reaches the wire AND the truncation", async () => {
  for (const n of [1, 4, 12, 25]) {
    const got = await run({ findResearch }, { wishlist: [wish()], limit: n });
    assert.deepEqual(got, { wire: n, echo: n, count: n }, `limit: ${n}`);
  }
});

test("an out-of-range per-call limit is clamped BEFORE the wire", async () => {
  const high = await run({ findResearch }, { wishlist: [wish()], limit: 99 });
  assert.notEqual(high.wire, 99);
  assert.deepEqual(high, { wire: 25, echo: 25, count: 25 });

  const low = await run({ findResearch }, { wishlist: [wish()], limit: 0 });
  assert.notEqual(low.wire, 0);
  assert.deepEqual(low, { wire: 1, echo: 1, count: 1 });
});

test("SKILLFED_RESEARCH_LIMIT=3 threads through as 3", async () => {
  process.env.SKILLFED_RESEARCH_LIMIT = "3";
  const m = await import("../findResearch.mjs?wire=3");
  delete process.env.SKILLFED_RESEARCH_LIMIT;
  assert.deepEqual(await run(m, { wishlist: [wish()] }), { wire: 3, echo: 3, count: 3 });
});

test("every wish gets its own request, all at the same resolved limit", async () => {
  seen.length = 0;
  const res = await findResearch({ wishlist: [wish(), wish(), wish()], limit: 6 });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map((s) => Number(s.query.limit)), [6, 6, 6]);
  assert.equal(res.n_wishes, 3);
  for (const r of res.results) assert.equal(r.candidates.length, 6);
});

test("privacy floor: only q and limit cross, and never the wish name", async () => {
  seen.length = 0;
  await findResearch({ wishlist: [wish({ keywords: ["curriculum", "difficulty", "pacing"] })], limit: 5 });
  const sentQuery = seen[0].query;
  assert.deepEqual(Object.keys(sentQuery).sort(), ["limit", "q"]);
  assert.match(sentQuery.q, /automatic curriculum generation/);
  assert.match(sentQuery.q, /curriculum/);
  assert.match(sentQuery.q, /pacing/);
  assert.equal(sentQuery.q.includes("SECRET-WISH-NAME"), false, "the wish `name` must stay local");
});

test("normalization drops score and keeps exactly the documented fields", async () => {
  nextConfidence = "strong";
  nextNote = undefined;
  const res = await findResearch({ wishlist: [wish()], limit: 2 });
  const [c] = res.results[0].candidates;
  assert.deepEqual(Object.keys(c).sort(), [
    "claim_title",
    "id",
    "meta_description",
    "page_url",
    "paper_title",
  ]);
  assert.equal("score" in c, false, "score must never be surfaced");
  assert.equal("authors_short" in c, false, "normalize keeps only the documented four plus id");
});

test("confidence: strong passes through with note null", async () => {
  nextConfidence = "strong";
  nextNote = undefined;
  const res = await findResearch({ wishlist: [wish()], limit: 3 });
  assert.equal(res.results[0].confidence, "strong");
  assert.equal(res.results[0].note, null, "note is absent on the wire when strong -> normalized to null");
});

test("confidence: weak passes through together with its note, verbatim", async () => {
  nextConfidence = "weak";
  nextNote = "no strong match in this corpus for this query - showing the closest available research, which may be only loosely related";
  const res = await findResearch({ wishlist: [wish()], limit: 3 });
  assert.equal(res.results[0].confidence, "weak");
  assert.equal(res.results[0].note, nextNote);
});
