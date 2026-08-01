/**
 * clampTopN + the top_n resolution order (per-call → SKILLFED_TOP_N → 10).
 *
 * Why this file exists: the remote 422s the WHOLE search for a top_n outside [1,25] — it
 * does not silently cap. So an unclamped env var (SKILLFED_TOP_N=50 was the shipped default
 * on one machine) broke every search, silently, at the transport layer. The clamp is the fix
 * and this is its regression test.
 *
 * SKILLFED_ENDPOINT is pinned EMPTY before every import: findSkills() is exercised here for
 * its echoed `top_n`, and with no endpoint the per-wish search fails fast inside searchOne
 * (which turns a throw into `result.error`) instead of touching the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKILLFED_ENDPOINT = "";
delete process.env.SKILLFED_TOP_N;

const mod = await import("../findSkills.mjs?topn=unset");
const { clampTopN, findSkills, REMOTE_TOP_N_MIN, REMOTE_TOP_N_MAX, TOP_N_DEFAULT } = mod;

const wish = () => ({ name: "n", description: "d", keywords: ["k"] });

/** Re-evaluate findSkills.mjs with a given SKILLFED_TOP_N (read once, at module load). */
async function withEnvTopN(value, tag) {
  if (value === undefined) delete process.env.SKILLFED_TOP_N;
  else process.env.SKILLFED_TOP_N = value;
  const m = await import(`../findSkills.mjs?topn=${tag}`);
  delete process.env.SKILLFED_TOP_N;
  return m;
}

test("the measured remote bounds are what the clamp enforces", () => {
  assert.equal(REMOTE_TOP_N_MIN, 1);
  assert.equal(REMOTE_TOP_N_MAX, 25);
});

test("every junk value lands inside [1,25]", () => {
  const junk = [0, -1, 26, 999, NaN, "7", 7.9, undefined, null, "", "abc", -0.5,
    Infinity, -Infinity, {}, [], true, "25.9", 1e9];
  for (const v of junk) {
    const got = clampTopN(v);
    assert.ok(Number.isInteger(got), `clampTopN(${String(v)}) → ${got} is not an integer`);
    assert.ok(
      got >= REMOTE_TOP_N_MIN && got <= REMOTE_TOP_N_MAX,
      `clampTopN(${String(v)}) → ${got} is outside [1,25]`
    );
  }
});

test("clampTopN maps each documented case exactly", () => {
  const cases = [
    [0, 1], [-1, 1], [1, 1], [10, 10], [25, 25], [26, 25], [999, 25],
    ["7", 7], [7.9, 7], ["25.9", 25], [-0.5, 1],
    // non-finite / unparseable → the fallback, which is the D5 default
    [NaN, 10], [undefined, 10], [null, 10], ["", 10], ["abc", 10], [Infinity, 10],
  ];
  for (const [input, expected] of cases) {
    assert.equal(clampTopN(input), expected, `clampTopN(${String(input)})`);
  }
});

test("the unset default is 10", () => {
  assert.equal(TOP_N_DEFAULT, 10);
});

test("SKILLFED_TOP_N sets the default, itself clamped", async () => {
  assert.equal((await withEnvTopN("3", "3")).TOP_N_DEFAULT, 3, "in range → honoured");
  assert.equal((await withEnvTopN("50", "50")).TOP_N_DEFAULT, 25, "50 used to 422 every search");
  assert.equal((await withEnvTopN("0", "0")).TOP_N_DEFAULT, 1);
  assert.equal((await withEnvTopN("999", "999")).TOP_N_DEFAULT, 25);
  assert.equal((await withEnvTopN("junk", "junk")).TOP_N_DEFAULT, 10, "unparseable → 10");
  assert.equal((await withEnvTopN("", "empty")).TOP_N_DEFAULT, 10);
  assert.equal((await withEnvTopN(undefined, "unset2")).TOP_N_DEFAULT, 10);
});

test("findSkills echoes the RESOLVED top_n, not the requested one", async () => {
  const call = async (input) => (await findSkills(input)).top_n;
  assert.equal(await call({ wishlist: [wish()] }), 10, "omitted → default");
  assert.equal(await call({ wishlist: [wish()], top_n: 12 }), 12);
  assert.equal(await call({ wishlist: [wish()], top_n: 99 }), 25, "99 clamps rather than 422s");
  assert.equal(await call({ wishlist: [wish()], top_n: 0 }), 1);
  assert.equal(await call({ wishlist: [wish()], top_n: "7" }), 7);
  assert.equal(await call({ wishlist: [wish()], top_n: null }), 10);
  assert.equal(await call([wish()]), 10, "bare-array input has no top_n → default");
});

test("a per-call top_n overrides SKILLFED_TOP_N", async () => {
  const m = await withEnvTopN("3", "override");
  assert.equal(m.TOP_N_DEFAULT, 3);
  assert.equal((await m.findSkills({ wishlist: [wish()], top_n: 20 })).top_n, 20);
  assert.equal((await m.findSkills({ wishlist: [wish()] })).top_n, 3);
});

test("a transport failure is per-wish, never a thrown search", async () => {
  // No endpoint → federation.search throws → searchOne records it and the other wishes live.
  const res = await findSkills({ wishlist: [wish(), wish()], top_n: 4 });
  assert.equal(res.top_n, 4, "the echo survives a failed search");
  assert.equal(res.results.length, 2);
  for (const r of res.results) {
    assert.match(r.error, /SKILLFED_ENDPOINT/);
    assert.deepEqual(r.candidates, []);
  }
});
