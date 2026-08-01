/**
 * Wish-list search — Node port of integrations/search_wishlist.py.
 *
 * The privacy-preserving replacement for "dump the whole plan as one wish". The
 * agent produces a WISH-LIST first — 1–10 wishes, each
 * {name, description, keywords[1–5], formulations[K paraphrases]} — and this runs
 * ONE search PER WISH, CONCURRENTLY, then normalizes + de-dupes the results.
 *
 * Per-wish query = description + up to K paraphrased formulations + the flattened
 * structured sketch (SIRA's expected-response sketch) concatenated into ONE BM25
 * query. BM25 is bag-of-words, so concatenation is a term-union query — empirically
 * matches a K-request RRF ensemble on recall@3 at 1/K the cost, no fusion. The
 * one-line description stays human-facing (the wish→match table); the formulations
 * carry lexical recall; the sketch supplies the rare, discriminative vocabulary a
 * matching SKILL.md would contain (SIRA step iii — the full sketch vocabulary in the
 * single weighted query, not the 1–5-keyword sliver). The same structured sketch
 * rides on the wish so the miss path emits it as the demand pointer, no re-derivation.
 *
 * The spec's find_skills takes the whole wish-list in one call; qurini's hosted
 * demo only exposes per-wish /search, so we emulate the batch by fanning out with
 * Promise.all (replaces Python's ThreadPoolExecutor).
 *
 * PRIVACY (Principle IV): each wish's description, paraphrased formulations, keywords,
 * AND its structured capability sketch cross the boundary on every search — all at the
 * "what skill should exist" abstraction. The plan, brief, outputs, and reasoning trace
 * never do.
 */

import { federation, ENDPOINT } from "./federation.mjs";
import { installedSkillNames, filterCandidates } from "./localSkills.mjs";

// The remote validates top_n and 422s the WHOLE search outside [1,25] — it does not
// silently cap (probed 2026-07-31). The service is not in this repo, so treat these as
// measured, not contractual, and re-probe if searches start 422-ing. Clamping here rather
// than retrying on 422 is deliberate: a retry would paper over a contract change we want
// to see. An unclamped SKILLFED_TOP_N=50 used to break every search.
const REMOTE_TOP_N_MIN = 1;
const REMOTE_TOP_N_MAX = 25;
const TOP_N_FALLBACK = 10; // raised from 5: at 5 the cut was excluding genuinely relevant skills

/**
 * Coerce anything (env string, JSON number, junk) into a wire-legal top_n.
 *
 * Only a number or a non-blank numeric string is a value; everything else (null, [], true, "",
 * {}) is junk and takes `fallback`. Number([]) and Number(false) are both 0, which would
 * otherwise clamp to 1 — a search for a single candidate, silently, from a type error.
 * `fallback` is a parameter so the caller can say what "not a value" resolves to: the env
 * default falls back to the literal 10, a junk PER-CALL value falls back to the env default,
 * which is the documented resolution order.
 */
export function clampTopN(n, fallback = TOP_N_FALLBACK) {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() ? Number(n) : NaN;
  if (!Number.isFinite(v)) return fallback;
  return Math.min(REMOTE_TOP_N_MAX, Math.max(REMOTE_TOP_N_MIN, Math.trunc(v)));
}

// Resolution order: per-call top_n → SKILLFED_TOP_N → 10, each clamped to [1,25]. Enforced in
// findSkills() below, which passes TOP_N_DEFAULT as the per-call fallback.
const TOP_N_DEFAULT = clampTopN(process.env.SKILLFED_TOP_N); // candidates per wish
const K = parseInt(process.env.SKILLFED_K || "4", 10); // paraphrase formulations per query

class InvalidWishlist extends Error {
  constructor(detail) {
    super(detail);
    this.name = "InvalidWishlist";
    this.code = "INVALID_WISHLIST";
  }
}

/** Validate + canonicalize the wish-list (mirrors search_wishlist.py _load_wishlist).
 * Exported for tests: it is the whole input contract, and asserting on it directly beats
 * inferring it from a search response. */
export function validateWishlist(input) {
  // Accept either a bare array or { wishlist: [...] }.
  const wishlist = Array.isArray(input) ? input : input && input.wishlist;
  if (!Array.isArray(wishlist) || wishlist.length < 1 || wishlist.length > 10) {
    throw new InvalidWishlist("wishlist must be a list of 1–10 wishes");
  }
  return wishlist.map((w, i) => {
    if (typeof w !== "object" || w === null) {
      throw new InvalidWishlist(`wish ${i} is not an object`);
    }
    const name = String(w.name || "").trim();
    const description = String(w.description || "").trim();
    const keywords = (w.keywords || [])
      .map((k) => String(k).trim())
      .filter(Boolean);
    const formulations = (w.formulations || [])
      .map((f) => String(f).trim())
      .filter(Boolean);
    if (!name || !description) {
      throw new InvalidWishlist(`wish ${i} missing name/description`);
    }
    if (keywords.length < 1 || keywords.length > 5) {
      throw new InvalidWishlist(
        `wish ${i} needs 1–5 keywords (got ${keywords.length}) — keyword ` +
          "generation is part of the ask, not optional"
      );
    }
    return {
      name,
      description,
      keywords,
      formulations: formulations.slice(0, K), // cap at K; empty → description-only
      sketch: normSketch(w.sketch), // optional; {} → behaves like the pre-sketch query
    };
  });
}

// Structured expected-response sketch (SIRA step i) — the demand-sketch.md schema.
// Optional on the wire: a wish with no sketch reproduces the pre-sketch query exactly.
const SKETCH_STR_FIELDS = ["purpose", "section_sketch"];
const SKETCH_LIST_FIELDS = ["inputs", "outputs", "operations", "domain_vocab", "tags"];

/** Coerce a wish's `sketch` into the canonical shape; non-object/empty → {}. */
function normSketch(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out = {};
  for (const f of SKETCH_STR_FIELDS) {
    const v = String(raw[f] || "").trim();
    if (v) out[f] = v;
  }
  for (const f of SKETCH_LIST_FIELDS) {
    const vals = (raw[f] || []).map((x) => String(x).trim()).filter(Boolean);
    if (vals.length) out[f] = vals;
  }
  return out;
}

/** Sketch → flat list of term-phrases for the bag-of-words query (values only, no JSON
 * keys/punctuation). domain_vocab/operations first — the vocab SIRA rewards. */
function flattenSketch(sketch) {
  if (!sketch) return [];
  const parts = [
    ...(sketch.domain_vocab || []),
    ...(sketch.operations || []),
    ...(sketch.inputs || []),
    ...(sketch.outputs || []),
  ];
  if (sketch.purpose) parts.push(sketch.purpose);
  if (sketch.section_sketch) parts.push(sketch.section_sketch);
  parts.push(...(sketch.tags || []));
  return parts.filter(Boolean);
}

/** qurini candidate → spec-ish candidate shape (mirrors _normalize). */
function normalize(c) {
  const t = c.trust || {};
  return {
    id: c.skill_id || c.id,
    name: c.name,
    description: c.description || "",
    score: c.score,
    status: c.status || "real",
    origin: c.origin,
    trust: {
      license: t.license,
      license_class: t.license_class || "review",
      provenance: t.provenance || "unverified",
      stars: t.stars,
    },
    security_flags: c.security_flags || [],
    source_url: c.source_url,
  };
}

/** Run one wish's search; never throws — transport errors become `error`. */
async function searchOne(wish, installed, topN) {
  const out = {
    wish,
    query_id: null,
    query_text: null,
    candidates: [],
    already_installed: [],
    empty: false,
    error: null,
  };
  // BM25 is bag-of-words: concatenate description + up to K formulations + the
  // flattened structured sketch (SIRA step iii) into ONE term-union query. keywords
  // ride along (@0.5 server-side); appended sketch terms ride at wish weight (1.0).
  // Dedup parts while preserving order.
  const parts = [
    wish.description,
    ...(wish.formulations || []),
    ...flattenSketch(wish.sketch),
  ].filter(Boolean);
  const queryText = [...new Set(parts)].join(" ");
  out.query_text = queryText;

  let res;
  try {
    res = await federation.search(queryText, wish.keywords, topN);
  } catch (e) {
    out.error = `${e.name || "Error"}: ${e.message}`;
    return out;
  }

  out.query_id = res.query_id ?? null;
  const raw = res.candidates || [];
  out.empty = raw.length === 0; // empty retrieval → demand pointer (so can all-rejected, later)
  const norm = raw.map(normalize);
  const [newOnes, have] = filterCandidates(norm, installed);
  out.candidates = newOnes.slice(0, topN);
  out.already_installed = have.map((h) => h.name);
  // adapter extras qurini provides (not in spec; aid the agent's selection).
  //
  // `recommendation` is deliberately NOT forwarded. The service still returns a string reading
  // "present the top 2-3 … then skillfed_fetch the chosen skill_id" — old single-pick,
  // install-first guidance, arriving from the server and contradicting everything the skill
  // body says about reading several. Passing it through would let it override the prompt
  // surface at runtime. Restore it once the service text is fixed (Track S item 3).
  for (const extra of ["confidence"]) {
    if (extra in res) out[extra] = res[extra];
  }
  return out;
}

/**
 * Search a whole wish-list. Returns the same object shape as
 * search_wishlist.py's stdout. Throws InvalidWishlist (code INVALID_WISHLIST)
 * on a bad input shape.
 *
 * `input` is either a bare wish array or {wishlist, top_n}. The resolved top_n is
 * echoed back, so the agent can see what it actually got when it asked for 99.
 */
export async function findSkills(input) {
  const wishlist = validateWishlist(input);
  // per-call top_n → SKILLFED_TOP_N → 10. A junk per-call value falls back to the env default
  // (not straight to 10), which is what the resolution order above claims.
  const requested =
    input && !Array.isArray(input) && input.top_n !== undefined ? input.top_n : undefined;
  const topN = requested === undefined ? TOP_N_DEFAULT : clampTopN(requested, TOP_N_DEFAULT);

  let installed;
  try {
    installed = installedSkillNames();
  } catch {
    installed = new Set();
  }

  const results = await Promise.all(wishlist.map((w) => searchOne(w, installed, topN)));

  return {
    endpoint_mode: ENDPOINT ? "hosted" : "local",
    top_n: topN,
    paraphrases_k: K,
    n_wishes: wishlist.length,
    results,
  };
}

export { InvalidWishlist, REMOTE_TOP_N_MIN, REMOTE_TOP_N_MAX, TOP_N_DEFAULT };
