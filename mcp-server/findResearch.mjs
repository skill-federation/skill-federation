/**
 * Research-wish search — sibling to findPackages.mjs, over a DIFFERENT index on the same host.
 *
 * Skills are capabilities for the agent itself; packages are libraries for the code being
 * written; research is the literature underneath both — the papers, benchmarks, and measured
 * claims that skills and packages are themselves often summarizing. find_research matches wishes
 * against skillfed.io's RESEARCH index — the portal's public GET /api/research/search.json (see
 * researchClient.mjs), no tenant, no auth, a distinct ranker over 191 research notes on agent-
 * skills literature.
 *
 * Unlike find_skills (~98% of skill candidates have no published page) and find_packages (some
 * candidates are thin), EVERY research candidate has a published /research/{slug} page — so a
 * result's page_url is always a working link, never a dead one.
 *
 * The agent produces a research wish-list first — 1–10 wishes, each a short topic/concept phrase
 * plus optional keywords — and this runs ONE search PER WISH, CONCURRENTLY (mirrors
 * findPackages.mjs's Promise.all fan-out), then normalizes.
 *
 * Wish-formulation rules baked into tools.mjs's tool description (derived from the live ranker's
 * field weights, not vibes):
 *   - The index weights concept_terms 3.0 / paper_title 2.5 / meta_description 1.5 /
 *     claim_title 0.75. concept_terms is CONTROLLED VOCABULARY (e.g. "automatic curriculum",
 *     "skill library", "self-verification"), so topic/concept phrasing beats guessing a paper
 *     name.
 *   - 3–8 dense words; long prose measurably dilutes the match (same crowd-out find_packages
 *     documents).
 *   - One topic per wish; fan a compound need out into separate wishes.
 *
 * CONFIDENCE (surfaced, never silently dropped): the portal returns `confidence: "strong"|"weak"`
 * per search, plus a `note` when weak. "weak" means the best match FOUND is a loose one — NOT
 * that the corpus was searched exhaustively and this is the closest thing that exists. An agent
 * reading a weak result should discount it, not treat it as proof of absence.
 *
 * KNOWN RETRIEVAL LIMIT (stated, not softened): a paraphrase with no lexical overlap AND weak
 * embedding similarity can miss the corpus entirely — measured at rank #67 of 191 on a real
 * query. No confidence label fixes that: the label describes a candidate that WAS returned, and
 * cannot rescue a note that never entered the top-k. So find_research returning nothing useful
 * does NOT prove no such research exists.
 *
 * PRIVACY (identical floor to find_skills / find_packages): only the topic phrase + keywords
 * cross the wire, folded into one `q` string — no file paths, plan text, or repo identifiers.
 * The wish `name`, if given, is display-only and stays local.
 *
 * `score` is NEVER surfaced: it's a sum of 1/(60+rank) RRF terms (max ~0.033) and reads as a
 * meaningless decimal to an agent or a user. Dropped in normalize(). `confidence` is a label
 * about match quality, not a score, and IS surfaced — see above.
 */

import { researchClient } from "./researchClient.mjs";

// The portal clamps `limit` server-side too (verified live 2026-08-16: limit=99 -> 25
// candidates, limit=0 -> 1) — this endpoint never 400s on an out-of-range limit either. We still
// clamp client-side so the echoed `limit` matches what was actually asked for, and so a junk
// value doesn't silently ride on whatever the server happens to default to. Bounds-alike with
// findPackages.mjs's clampLimit by coincidence, not by a shared contract — kept as its own copy
// here for the same reason that module keeps its own copy rather than importing find_skills'.
const LIMIT_MIN = 1;
const LIMIT_MAX = 25;
const LIMIT_FALLBACK = 10;

/** Coerce anything into a wire-legal limit; see clampLimit in findPackages.mjs for the twin. */
export function clampLimit(n, fallback = LIMIT_FALLBACK) {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() ? Number(n) : NaN;
  if (!Number.isFinite(v)) return fallback;
  return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(v)));
}

// Resolution order: per-call limit → SKILLFED_RESEARCH_LIMIT → 10, each clamped to [1,25].
const LIMIT_DEFAULT = clampLimit(process.env.SKILLFED_RESEARCH_LIMIT);

class InvalidResearchWishlist extends Error {
  constructor(detail) {
    super(detail);
    this.name = "InvalidResearchWishlist";
    this.code = "INVALID_RESEARCH_WISHLIST";
  }
}

/** Validate + canonicalize the research wish-list. Exported for tests: it is the whole input
 * contract, and asserting on it directly beats inferring it from a search response. Shape is
 * identical to validatePackageWishlist — only description is required, keywords optional. */
export function validateResearchWishlist(input) {
  // Accept either a bare array or { wishlist: [...] }.
  const wishlist = Array.isArray(input) ? input : input && input.wishlist;
  if (!Array.isArray(wishlist) || wishlist.length < 1 || wishlist.length > 10) {
    throw new InvalidResearchWishlist("wishlist must be a list of 1–10 research wishes");
  }
  return wishlist.map((w, i) => {
    if (typeof w !== "object" || w === null) {
      throw new InvalidResearchWishlist(`wish ${i} is not an object`);
    }
    const name = String(w.name || "").trim();
    const description = String(w.description || "").trim();
    const keywords = (w.keywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!description) {
      throw new InvalidResearchWishlist(`wish ${i} missing description`);
    }
    return { name, description, keywords };
  });
}

/** portal candidate → normalized shape. `score` is deliberately dropped (see module docstring).
 * `id` is kept as the stable reference (an arXiv-style id) alongside the four fields the task
 * spec calls out: paper_title, claim_title, meta_description, page_url. */
function normalize(c) {
  return {
    id: c.id,
    paper_title: c.paper_title,
    claim_title: c.claim_title,
    meta_description: c.meta_description,
    page_url: c.page_url,
  };
}

/** Run one wish's search; never throws — transport errors become `error`. */
async function searchOne(wish, limit) {
  const out = {
    wish,
    query: null,
    candidates: [],
    count: 0,
    confidence: null,
    note: null,
    error: null,
  };
  // The endpoint takes a single `q` string — fold description + keywords into one space-joined
  // query (dedup while preserving order), same term-union approach as find_packages' wish string.
  const parts = [wish.description, ...(wish.keywords || [])].filter(Boolean);
  const q = [...new Set(parts)].join(" ");
  out.query = q;

  let res;
  try {
    res = await researchClient.search(q, limit);
  } catch (e) {
    out.error = `${e.name || "Error"}: ${e.message}`;
    return out;
  }

  const raw = (res && res.candidates) || [];
  out.candidates = raw.map(normalize).slice(0, limit);
  out.count = out.candidates.length;
  // confidence is always present on a successful response; note only when confidence is "weak"
  // (absent, not null, on the wire) — normalize its absence to null rather than undefined so the
  // shape is stable whichever way the search landed.
  out.confidence = (res && res.confidence) || null;
  out.note = (res && res.note) || null;
  return out;
}

/**
 * Search a whole research wish-list. `input` is either a bare wish array or {wishlist, limit}.
 * The resolved limit is echoed back, so the agent can see what it actually got when it asked for
 * 99. Throws InvalidResearchWishlist (code INVALID_RESEARCH_WISHLIST) on a bad input shape.
 */
export async function findResearch(input) {
  const wishlist = validateResearchWishlist(input);
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

export { InvalidResearchWishlist, LIMIT_MIN, LIMIT_MAX, LIMIT_DEFAULT };
