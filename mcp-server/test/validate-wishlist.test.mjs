/**
 * validateWishlist — the input contract.
 *
 * This is the only gate between a model's improvised JSON and a federation request, so it
 * gets asserted directly rather than inferred from a search response.
 *
 * The env is pinned BEFORE the (deliberately dynamic) import: findSkills.mjs reads
 * SKILLFED_K at module load, and an empty SKILLFED_ENDPOINT guarantees that nothing in
 * this file can reach a real federation even if the developer's shell exports one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKILLFED_ENDPOINT = "";
process.env.SKILLFED_K = "4";

const { validateWishlist, InvalidWishlist } = await import("../findSkills.mjs");

/** A minimal valid wish; override one field per case. */
const wish = (over = {}) => ({
  name: "seo-audit",
  description: "audit a site for technical SEO",
  keywords: ["seo"],
  ...over,
});

const rejects = (input, why) =>
  assert.throws(() => validateWishlist(input), (e) => {
    assert.ok(e instanceof InvalidWishlist, `expected InvalidWishlist, got ${e.name}`);
    assert.equal(e.code, "INVALID_WISHLIST");
    return true;
  }, why);

test("accepts both input shapes and canonicalizes identically", () => {
  const bare = validateWishlist([wish()]);
  const wrapped = validateWishlist({ wishlist: [wish()] });
  assert.equal(bare.length, 1);
  assert.deepEqual(bare, wrapped);
});

test("sibling fields on the wrapped shape are ignored by the validator", () => {
  // index.mjs passes the whole args object (top_n rides alongside wishlist).
  const out = validateWishlist({ wishlist: [wish()], top_n: 12 });
  assert.equal(out.length, 1);
  assert.equal(out[0].top_n, undefined);
});

test("wish count: 0 and 11 rejected, 1 and 10 accepted", () => {
  rejects([], "0 wishes (bare)");
  rejects({ wishlist: [] }, "0 wishes (wrapped)");
  rejects(Array.from({ length: 11 }, () => wish()), "11 wishes");
  assert.equal(validateWishlist([wish()]).length, 1);
  assert.equal(validateWishlist(Array.from({ length: 10 }, () => wish())).length, 10);
});

test("non-list input is rejected", () => {
  rejects(null, "null");
  rejects({}, "no wishlist key");
  rejects({ wishlist: "seo" }, "string wishlist");
  rejects(42, "number");
});

test("a non-object wish is rejected", () => {
  rejects(["just a string"], "string wish");
  rejects([null], "null wish");
});

test("missing name or description is rejected", () => {
  rejects([wish({ name: undefined })], "no name");
  rejects([wish({ description: undefined })], "no description");
  rejects([wish({ name: "   " })], "whitespace-only name");
  rejects([wish({ description: "" })], "empty description");
});

test("keywords: 0 and 6 rejected, 1 and 5 accepted", () => {
  rejects([wish({ keywords: [] })], "0 keywords");
  rejects([wish({ keywords: undefined })], "keywords omitted");
  rejects([wish({ keywords: ["  ", ""] })], "blank keywords count as 0");
  rejects([wish({ keywords: ["a", "b", "c", "d", "e", "f"] })], "6 keywords");
  assert.equal(validateWishlist([wish({ keywords: ["a"] })])[0].keywords.length, 1);
  assert.equal(
    validateWishlist([wish({ keywords: ["a", "b", "c", "d", "e"] })])[0].keywords.length,
    5
  );
});

test("formulations are truncated to K and blanks dropped", () => {
  const many = Array.from({ length: 7 }, (_, i) => `paraphrase ${i}`);
  const out = validateWishlist([wish({ formulations: many })])[0];
  assert.equal(out.formulations.length, 4, "K defaults to 4");
  assert.deepEqual(out.formulations, many.slice(0, 4), "keeps the FIRST K, in order");

  assert.deepEqual(validateWishlist([wish({ formulations: [] })])[0].formulations, []);
  assert.deepEqual(validateWishlist([wish({ formulations: undefined })])[0].formulations, []);
  assert.deepEqual(
    validateWishlist([wish({ formulations: ["  ", "kept", ""] })])[0].formulations,
    ["kept"],
    "blank paraphrases are dropped, not counted against K"
  );
});

test("K is the cap, not a hardcoded 4", async () => {
  // Cache-bust the specifier: findSkills.mjs reads SKILLFED_K once, at module load.
  process.env.SKILLFED_K = "2";
  const k2 = await import("../findSkills.mjs?k=2");
  process.env.SKILLFED_K = "4";
  const out = k2.validateWishlist([wish({ formulations: ["a", "b", "c", "d"] })])[0];
  assert.equal(out.formulations.length, 2);
});

test("a non-object sketch is coerced to {}", () => {
  for (const bad of ["a string", 7, true, null, undefined, ["a", "list"]]) {
    const out = validateWishlist([wish({ sketch: bad })])[0];
    assert.deepEqual(out.sketch, {}, `sketch ${JSON.stringify(bad)} → {}`);
  }
});

test("a real sketch keeps only the canonical fields, stringified and trimmed", () => {
  const out = validateWishlist([
    wish({
      sketch: {
        purpose: "  find stale structured data  ",
        inputs: ["url", "  ", ""],
        outputs: ["report"],
        operations: ["crawl"],
        domain_vocab: ["schema.org", 42],
        section_sketch: "checks · fixes",
        tags: ["seo"],
        not_a_field: "dropped",
        plan: "THIS MUST NOT SURVIVE",
      },
    }),
  ])[0];

  assert.deepEqual(out.sketch, {
    purpose: "find stale structured data",
    section_sketch: "checks · fixes",
    inputs: ["url"],
    outputs: ["report"],
    operations: ["crawl"],
    domain_vocab: ["schema.org", "42"],
    tags: ["seo"],
  });
  assert.equal("not_a_field" in out.sketch, false);
  assert.equal("plan" in out.sketch, false, "unknown sketch keys never reach the wire");
});

test("canonicalized wishes carry exactly the five wire fields", () => {
  const out = validateWishlist([wish({ extra: "nope", formulations: ["p"] })])[0];
  assert.deepEqual(Object.keys(out).sort(), [
    "description",
    "formulations",
    "keywords",
    "name",
    "sketch",
  ]);
});
