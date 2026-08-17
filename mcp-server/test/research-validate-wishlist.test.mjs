/**
 * validateResearchWishlist — the input contract for find_research.
 *
 * Sibling to validate-package-wishlist.test.mjs (find_packages), same thin shape: a research
 * wish has no formulations/sketch, and keywords are optional rather than required 1–5, since the
 * description alone is often already a complete topic phrase.
 *
 * findResearch.mjs makes no network call by default (researchClient.mjs only fires on search),
 * so no endpoint needs to be pinned here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { validateResearchWishlist, InvalidResearchWishlist } = await import("../findResearch.mjs");

/** A minimal valid wish; override one field per case. */
const wish = (over = {}) => ({
  description: "automatic curriculum generation",
  ...over,
});

const rejects = (input, why) =>
  assert.throws(
    () => validateResearchWishlist(input),
    (e) => {
      assert.ok(e instanceof InvalidResearchWishlist, `expected InvalidResearchWishlist, got ${e.name}`);
      assert.equal(e.code, "INVALID_RESEARCH_WISHLIST");
      return true;
    },
    why
  );

test("accepts both input shapes and canonicalizes identically", () => {
  const bare = validateResearchWishlist([wish()]);
  const wrapped = validateResearchWishlist({ wishlist: [wish()] });
  assert.equal(bare.length, 1);
  assert.deepEqual(bare, wrapped);
});

test("sibling fields on the wrapped shape are ignored by the validator", () => {
  // index.mjs passes the whole args object (limit rides alongside wishlist).
  const out = validateResearchWishlist({ wishlist: [wish()], limit: 12 });
  assert.equal(out.length, 1);
  assert.equal(out[0].limit, undefined);
});

test("wish count: 0 and 11 rejected, 1 and 10 accepted", () => {
  rejects([], "0 wishes (bare)");
  rejects({ wishlist: [] }, "0 wishes (wrapped)");
  rejects(Array.from({ length: 11 }, () => wish()), "11 wishes");
  assert.equal(validateResearchWishlist([wish()]).length, 1);
  assert.equal(validateResearchWishlist(Array.from({ length: 10 }, () => wish())).length, 10);
});

test("non-list input is rejected", () => {
  rejects(null, "null");
  rejects({}, "no wishlist key");
  rejects({ wishlist: "curriculum learning" }, "string wishlist");
  rejects(42, "number");
});

test("a non-object wish is rejected", () => {
  rejects(["just a string"], "string wish");
  rejects([null], "null wish");
});

test("missing or blank description is rejected", () => {
  rejects([wish({ description: undefined })], "no description");
  rejects([wish({ description: "" })], "empty description");
  rejects([wish({ description: "   " })], "whitespace-only description");
});

test("name is optional and display-only", () => {
  const out = validateResearchWishlist([wish()])[0];
  assert.equal(out.name, "", "no name supplied -> empty string, not required");
  const named = validateResearchWishlist([wish({ name: "curriculum" })])[0];
  assert.equal(named.name, "curriculum");
});

test("keywords are optional, capped at 5, blanks dropped", () => {
  assert.deepEqual(validateResearchWishlist([wish()])[0].keywords, [], "keywords omitted -> []");
  assert.deepEqual(validateResearchWishlist([wish({ keywords: [] })])[0].keywords, []);
  assert.deepEqual(
    validateResearchWishlist([wish({ keywords: ["  ", ""] })])[0].keywords,
    [],
    "blank keywords are dropped, not counted"
  );
  assert.deepEqual(
    validateResearchWishlist([wish({ keywords: ["curriculum", "difficulty"] })])[0].keywords,
    ["curriculum", "difficulty"]
  );
  const six = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(
    validateResearchWishlist([wish({ keywords: six })])[0].keywords,
    six.slice(0, 5),
    "6 keywords truncated to 5, not rejected"
  );
});

test("canonicalized wishes carry exactly the three wire fields", () => {
  const out = validateResearchWishlist([wish({ extra: "nope", limit: 99 })])[0];
  assert.deepEqual(Object.keys(out).sort(), ["description", "keywords", "name"]);
});
