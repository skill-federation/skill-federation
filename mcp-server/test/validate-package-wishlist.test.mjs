/**
 * validatePackageWishlist — the input contract for find_packages.
 *
 * Sibling to validate-wishlist.test.mjs (find_skills), but the shape is deliberately
 * thinner: a package wish has no formulations/sketch (the portal's ranker takes a single
 * `q` string, not a BM25 term-union query), and keywords are optional rather than
 * required 1–5, since the description alone is often already a complete capability phrase.
 *
 * findPackages.mjs makes no network call by default (packagesClient.mjs only fires on
 * search), so no endpoint needs to be pinned here the way findSkills.mjs's SKILLFED_K
 * does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const { validatePackageWishlist, InvalidPackageWishlist } = await import("../findPackages.mjs");

/** A minimal valid wish; override one field per case. */
const wish = (over = {}) => ({
  description: "parse yaml config",
  ...over,
});

const rejects = (input, why) =>
  assert.throws(
    () => validatePackageWishlist(input),
    (e) => {
      assert.ok(e instanceof InvalidPackageWishlist, `expected InvalidPackageWishlist, got ${e.name}`);
      assert.equal(e.code, "INVALID_PACKAGE_WISHLIST");
      return true;
    },
    why
  );

test("accepts both input shapes and canonicalizes identically", () => {
  const bare = validatePackageWishlist([wish()]);
  const wrapped = validatePackageWishlist({ wishlist: [wish()] });
  assert.equal(bare.length, 1);
  assert.deepEqual(bare, wrapped);
});

test("sibling fields on the wrapped shape are ignored by the validator", () => {
  // index.mjs passes the whole args object (limit rides alongside wishlist).
  const out = validatePackageWishlist({ wishlist: [wish()], limit: 12 });
  assert.equal(out.length, 1);
  assert.equal(out[0].limit, undefined);
});

test("wish count: 0 and 11 rejected, 1 and 10 accepted", () => {
  rejects([], "0 wishes (bare)");
  rejects({ wishlist: [] }, "0 wishes (wrapped)");
  rejects(Array.from({ length: 11 }, () => wish()), "11 wishes");
  assert.equal(validatePackageWishlist([wish()]).length, 1);
  assert.equal(validatePackageWishlist(Array.from({ length: 10 }, () => wish())).length, 10);
});

test("non-list input is rejected", () => {
  rejects(null, "null");
  rejects({}, "no wishlist key");
  rejects({ wishlist: "pyyaml" }, "string wishlist");
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
  const out = validatePackageWishlist([wish()])[0];
  assert.equal(out.name, "", "no name supplied -> empty string, not required");
  const named = validatePackageWishlist([wish({ name: "yaml-config" })])[0];
  assert.equal(named.name, "yaml-config");
});

test("keywords are optional, capped at 5, blanks dropped", () => {
  assert.deepEqual(validatePackageWishlist([wish()])[0].keywords, [], "keywords omitted -> []");
  assert.deepEqual(validatePackageWishlist([wish({ keywords: [] })])[0].keywords, []);
  assert.deepEqual(
    validatePackageWishlist([wish({ keywords: ["  ", ""] })])[0].keywords,
    [],
    "blank keywords are dropped, not counted"
  );
  assert.deepEqual(
    validatePackageWishlist([wish({ keywords: ["yaml", "config"] })])[0].keywords,
    ["yaml", "config"]
  );
  const six = ["a", "b", "c", "d", "e", "f"];
  assert.deepEqual(
    validatePackageWishlist([wish({ keywords: six })])[0].keywords,
    six.slice(0, 5),
    "6 keywords truncated to 5, not rejected (unlike find_skills' 1-5 requirement)"
  );
});

test("canonicalized wishes carry exactly the three wire fields", () => {
  const out = validatePackageWishlist([wish({ extra: "nope", limit: 99 })])[0];
  assert.deepEqual(Object.keys(out).sort(), ["description", "keywords", "name"]);
});
