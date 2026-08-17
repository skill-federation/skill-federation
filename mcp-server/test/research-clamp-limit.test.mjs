/**
 * clampLimit + the limit resolution order (per-call → SKILLFED_RESEARCH_LIMIT → 10), for
 * find_research.
 *
 * Sibling to clamp-limit.test.mjs (find_packages). The portal clamps `limit` server-side too
 * (verified live 2026-08-16: limit=99 → 25 candidates, limit=0 → 1) — this endpoint never 400s
 * the whole search for an out-of-range value either. We still clamp client-side so the echoed
 * `limit` matches what was actually asked for, and so a junk value doesn't silently ride on the
 * server's own default instead of ours.
 *
 * SKILLFED_RESEARCH_ENDPOINT is pinned to an unreachable loopback port before every import:
 * findResearch() is exercised here for its echoed `limit`, and with no listener the per-wish
 * search fails fast inside searchOne (which turns a throw into `result.error`) instead of
 * touching the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKILLFED_RESEARCH_ENDPOINT = "http://127.0.0.1:1"; // reserved, always refuses
delete process.env.SKILLFED_RESEARCH_LIMIT;

const mod = await import("../findResearch.mjs?limit=unset");
const { clampLimit, findResearch, LIMIT_MIN, LIMIT_MAX, LIMIT_DEFAULT } = mod;

const wish = () => ({ description: "automatic curriculum generation" });

/** Re-evaluate findResearch.mjs with a given SKILLFED_RESEARCH_LIMIT (read once, at module load). */
async function withEnvLimit(value, tag) {
  if (value === undefined) delete process.env.SKILLFED_RESEARCH_LIMIT;
  else process.env.SKILLFED_RESEARCH_LIMIT = value;
  const m = await import(`../findResearch.mjs?limit=${tag}`);
  delete process.env.SKILLFED_RESEARCH_LIMIT;
  return m;
}

test("the bounds are 1..25, same shape as find_packages' limit", () => {
  assert.equal(LIMIT_MIN, 1);
  assert.equal(LIMIT_MAX, 25);
});

test("every junk value lands inside [1,25]", () => {
  const junk = [0, -1, 26, 999, NaN, "7", 7.9, undefined, null, "", "abc", -0.5,
    Infinity, -Infinity, {}, [], true, "25.9", 1e9];
  for (const v of junk) {
    const got = clampLimit(v);
    assert.ok(Number.isInteger(got), `clampLimit(${String(v)}) → ${got} is not an integer`);
    assert.ok(got >= LIMIT_MIN && got <= LIMIT_MAX, `clampLimit(${String(v)}) → ${got} is outside [1,25]`);
  }
});

test("clampLimit maps each documented case exactly", () => {
  const cases = [
    [0, 1], [-1, 1], [1, 1], [10, 10], [25, 25], [26, 25], [999, 25],
    ["7", 7], [7.9, 7], ["25.9", 25], [-0.5, 1],
    [NaN, 10], [undefined, 10], [null, 10], ["", 10], ["abc", 10], [Infinity, 10],
  ];
  for (const [input, expected] of cases) {
    assert.equal(clampLimit(input), expected, `clampLimit(${String(input)})`);
  }
});

test("the unset default is 10", () => {
  assert.equal(LIMIT_DEFAULT, 10);
});

test("SKILLFED_RESEARCH_LIMIT sets the default, itself clamped", async () => {
  assert.equal((await withEnvLimit("3", "3")).LIMIT_DEFAULT, 3, "in range → honoured");
  assert.equal((await withEnvLimit("50", "50")).LIMIT_DEFAULT, 25);
  assert.equal((await withEnvLimit("0", "0")).LIMIT_DEFAULT, 1);
  assert.equal((await withEnvLimit("999", "999")).LIMIT_DEFAULT, 25);
  assert.equal((await withEnvLimit("junk", "junk")).LIMIT_DEFAULT, 10, "unparseable → 10");
  assert.equal((await withEnvLimit("", "empty")).LIMIT_DEFAULT, 10);
  assert.equal((await withEnvLimit(undefined, "unset2")).LIMIT_DEFAULT, 10);
});

test("findResearch echoes the RESOLVED limit, not the requested one", async () => {
  const call = async (input) => (await findResearch(input)).limit;
  assert.equal(await call({ wishlist: [wish()] }), 10, "omitted → default");
  assert.equal(await call({ wishlist: [wish()], limit: 12 }), 12);
  assert.equal(await call({ wishlist: [wish()], limit: 99 }), 25, "99 clamps");
  assert.equal(await call({ wishlist: [wish()], limit: 0 }), 1);
  assert.equal(await call({ wishlist: [wish()], limit: "7" }), 7);
  assert.equal(await call({ wishlist: [wish()], limit: null }), 10);
  assert.equal(await call([wish()]), 10, "bare-array input has no limit → default");
});

test("a per-call limit overrides SKILLFED_RESEARCH_LIMIT", async () => {
  const m = await withEnvLimit("3", "override");
  assert.equal(m.LIMIT_DEFAULT, 3);
  assert.equal((await m.findResearch({ wishlist: [wish()], limit: 20 })).limit, 20);
  assert.equal((await m.findResearch({ wishlist: [wish()] })).limit, 3);
});

test("a transport failure is per-wish, never a thrown search", async () => {
  const res = await findResearch({ wishlist: [wish(), wish()], limit: 4 });
  assert.equal(res.limit, 4, "the echo survives a failed search");
  assert.equal(res.results.length, 2);
  for (const r of res.results) {
    assert.ok(r.error, "expected a transport error against the unreachable endpoint");
    assert.deepEqual(r.candidates, []);
    assert.equal(r.count, 0);
    assert.equal(r.confidence, null, "confidence stays null on a transport failure");
    assert.equal(r.note, null);
  }
});
