/**
 * clampLimit + the limit resolution order (per-call → SKILLFED_PKG_LIMIT → 10).
 *
 * Sibling to clamp-top-n.test.mjs (find_skills' clampTopN). The portal clamps `limit`
 * server-side too (verified live 2026-08-14: limit=99 → 25 candidates, limit=0 → 1) —
 * unlike find_skills' remote, it never 400s the whole search for an out-of-range value.
 * We still clamp client-side so the echoed `limit` matches what was actually asked for,
 * and so a junk value doesn't silently ride on the server's own default instead of ours.
 *
 * SKILLFED_PACKAGES_ENDPOINT is pinned to an unreachable loopback port before every
 * import: findPackages() is exercised here for its echoed `limit`, and with no listener
 * the per-wish search fails fast inside searchOne (which turns a throw into
 * `result.error`) instead of touching the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKILLFED_PACKAGES_ENDPOINT = "http://127.0.0.1:1"; // reserved, always refuses
delete process.env.SKILLFED_PKG_LIMIT;

const mod = await import("../findPackages.mjs?limit=unset");
const { clampLimit, findPackages, LIMIT_MIN, LIMIT_MAX, LIMIT_DEFAULT } = mod;

const wish = () => ({ description: "parse yaml config" });

/** Re-evaluate findPackages.mjs with a given SKILLFED_PKG_LIMIT (read once, at module load). */
async function withEnvLimit(value, tag) {
  if (value === undefined) delete process.env.SKILLFED_PKG_LIMIT;
  else process.env.SKILLFED_PKG_LIMIT = value;
  const m = await import(`../findPackages.mjs?limit=${tag}`);
  delete process.env.SKILLFED_PKG_LIMIT;
  return m;
}

test("the bounds are 1..25, same shape as find_skills' top_n", () => {
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

test("SKILLFED_PKG_LIMIT sets the default, itself clamped", async () => {
  assert.equal((await withEnvLimit("3", "3")).LIMIT_DEFAULT, 3, "in range → honoured");
  assert.equal((await withEnvLimit("50", "50")).LIMIT_DEFAULT, 25);
  assert.equal((await withEnvLimit("0", "0")).LIMIT_DEFAULT, 1);
  assert.equal((await withEnvLimit("999", "999")).LIMIT_DEFAULT, 25);
  assert.equal((await withEnvLimit("junk", "junk")).LIMIT_DEFAULT, 10, "unparseable → 10");
  assert.equal((await withEnvLimit("", "empty")).LIMIT_DEFAULT, 10);
  assert.equal((await withEnvLimit(undefined, "unset2")).LIMIT_DEFAULT, 10);
});

test("findPackages echoes the RESOLVED limit, not the requested one", async () => {
  const call = async (input) => (await findPackages(input)).limit;
  assert.equal(await call({ wishlist: [wish()] }), 10, "omitted → default");
  assert.equal(await call({ wishlist: [wish()], limit: 12 }), 12);
  assert.equal(await call({ wishlist: [wish()], limit: 99 }), 25, "99 clamps");
  assert.equal(await call({ wishlist: [wish()], limit: 0 }), 1);
  assert.equal(await call({ wishlist: [wish()], limit: "7" }), 7);
  assert.equal(await call({ wishlist: [wish()], limit: null }), 10);
  assert.equal(await call([wish()]), 10, "bare-array input has no limit → default");
});

test("a per-call limit overrides SKILLFED_PKG_LIMIT", async () => {
  const m = await withEnvLimit("3", "override");
  assert.equal(m.LIMIT_DEFAULT, 3);
  assert.equal((await m.findPackages({ wishlist: [wish()], limit: 20 })).limit, 20);
  assert.equal((await m.findPackages({ wishlist: [wish()] })).limit, 3);
});

test("a transport failure is per-wish, never a thrown search", async () => {
  const res = await findPackages({ wishlist: [wish(), wish()], limit: 4 });
  assert.equal(res.limit, 4, "the echo survives a failed search");
  assert.equal(res.results.length, 2);
  for (const r of res.results) {
    assert.ok(r.error, "expected a transport error against the unreachable endpoint");
    assert.deepEqual(r.candidates, []);
    assert.equal(r.count, 0);
  }
});
