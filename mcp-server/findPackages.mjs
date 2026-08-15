/**
 * Package-wish search — sibling to findSkills.mjs, over a DIFFERENT service.
 *
 * Skills are capabilities for the agent itself; packages are libraries for the code
 * being written. find_skills matches wishes against the federated SKILL catalog
 * (qurini's /search, POST, tenant-scoped, via federation.mjs); find_packages matches
 * wishes against skillfed.io's PACKAGE index — the portal's public GET
 * /api/packages/search.json (see packagesClient.mjs), no tenant, no auth, a distinct
 * ranker over PyPI packages.
 *
 * The agent produces a package wish-list first — 1–10 wishes, each a short capability
 * phrase plus optional keywords — and this runs ONE search PER WISH, CONCURRENTLY
 * (mirrors findSkills.mjs's Promise.all fan-out), then normalizes.
 *
 * Wish-formulation rules baked into tools.mjs's tool description (state them as rules,
 * derived from the live ranker, not vibes):
 *   - Phrase the TASK, not a package name — the tags lane is weighted 3x and
 *     `what_it_does` is task vocabulary, so "parse yaml config" outranks guessing "pyyaml".
 *   - 3–8 dense words; long prose measurably dilutes the match (query crowd-out).
 *   - One capability per wish; fan a compound need out into separate wishes.
 *   - License/maintenance/popularity are FILTERS on the returned license_treatment/tier
 *     fields, not extra query words hoping to steer the ranker.
 *
 * PRIVACY (identical floor to find_skills): only the capability phrase + keywords cross
 * the wire, folded into one `q` string — no file paths, plan text, or repo identifiers.
 * The wish `name`, if given, is display-only and stays local (same rule as find_skills'
 * wish `name`).
 *
 * `score` is NEVER surfaced: it's a sum of 1/(60+rank) RRF terms (max ~0.033) and reads
 * as a meaningless decimal to an agent or a user. Dropped in normalize().
 */

import { packagesClient } from "./packagesClient.mjs";

// The portal clamps `limit` server-side too (verified live 2026-08-14: limit=99 -> 25
// candidates, limit=0 -> 1) — unlike find_skills' remote, this endpoint never 400s on an
// out-of-range limit. We still clamp client-side so the echoed `limit` matches what was
// actually asked for, and so a junk value doesn't silently ride on whatever the server
// happens to default to. Mirrors clampTopN in findSkills.mjs; kept as its own small
// function here (rather than imported) because the two are bounds-alike by coincidence,
// not by a shared contract — re-verify independently if either service's bounds move.
const LIMIT_MIN = 1;
const LIMIT_MAX = 25;
const LIMIT_FALLBACK = 10;

/** Coerce anything into a wire-legal limit; see clampTopN in findSkills.mjs for the twin. */
export function clampLimit(n, fallback = LIMIT_FALLBACK) {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() ? Number(n) : NaN;
  if (!Number.isFinite(v)) return fallback;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(v)));
}

// Resolution order: per-call limit → SKILLFED_PKG_LIMIT → 10, each clamped to [1,25].
const LIMIT_DEFAULT = clampLimit(process.env.SKILLFED_PKG_LIMIT);

class InvalidPackageWishlist extends Error {
  constructor(detail) {
    super(detail);
    this.name = "InvalidPackageWishlist";
    this.code = "INVALID_PACKAGE_WISHLIST";
  }
}

/** Validate + canonicalize the package wish-list. Exported for tests: it is the whole
 * input contract, and asserting on it directly beats inferring it from a search response. */
export function validatePackageWishlist(input) {
  // Accept either a bare array or { wishlist: [...] }.
  const wishlist = Array.isArray(input) ? input : input && input.wishlist;
  if (!Array.isArray(wishlist) || wishlist.length < 1 || wishlist.length > 10) {
    throw new InvalidPackageWishlist("wishlist must be a list of 1–10 package wishes");
  }
  return wishlist.map((w, i) => {
    if (typeof w !== "object" || w === null) {
      throw new InvalidPackageWishlist(`wish ${i} is not an object`);
    }
    const name = String(w.name || "").trim();
    const description = String(w.description || "").trim();
    const keywords = (w.keywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!description) {
      throw new InvalidPackageWishlist(`wish ${i} missing description`);
    }
    return { name, description, keywords };
  });
}

/** portal candidate → normalized shape. `score` is deliberately dropped (see module docstring). */
function normalize(c) {
  return {
    id: c.id,
    name: c.name,
    capability: c.capability,
    worth_installing: c.worth_installing,
    license_treatment: c.license_treatment,
    tier: c.tier,
    page_url: c.page_url,
    md_url: c.md_url,
    json_url: c.json_url,
  };
}

/** Run one wish's search; never throws — transport errors become `error`. */
async function searchOne(wish, limit) {
  const out = { wish, query: null, candidates: [], count: 0, error: null };
  // The endpoint takes a single `q` string — fold description + keywords into one
  // space-joined query (dedup while preserving order), same term-union approach as
  // find_skills' wish string.
  const parts = [wish.description, ...(wish.keywords || [])].filter(Boolean);
  const q = [...new Set(parts)].join(" ");
  out.query = q;

  let res;
  try {
    res = await packagesClient.search(q, limit);
  } catch (e) {
    out.error = `${e.name || "Error"}: ${e.message}`;
    return out;
  }

  const raw = (res && res.candidates) || [];
  out.candidates = raw.map(normalize).slice(0, limit);
  out.count = out.candidates.length;
  return out;
}

/**
 * Search a whole package wish-list. `input` is either a bare wish array or
 * {wishlist, limit}. The resolved limit is echoed back, so the agent can see what it
 * actually got when it asked for 99. Throws InvalidPackageWishlist (code
 * INVALID_PACKAGE_WISHLIST) on a bad input shape.
 */
export async function findPackages(input) {
  const wishlist = validatePackageWishlist(input);
  const requested =
    input && !Array.isArray(input) && input.limit !== undefined ? input.limit : undefined;
  const limit = requested === undefined ? LIMIT_DEFAULT : clampLimit(requested, LIMIT_DEFAULT);

  const results = await Promise.all(wishlist.map((w) => searchOne(w, limit)));

  return {
    limit,
    n_wishes: wishlist.length,
    results,
  };
}

export { InvalidPackageWishlist, LIMIT_MIN, LIMIT_MAX, LIMIT_DEFAULT };
