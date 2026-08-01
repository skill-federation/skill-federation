/**
 * Skill Federation client — Node port of integrations/skillfed_client.py.
 *
 * HOSTED-ONLY: the federation core lives behind an HTTPS API (qurini's keyless
 * demo today; our own federation later). Unlike the Python client, this has no
 * local-core branch — the MCP server always talks to SKILLFED_ENDPOINT. Swapping
 * the demo for our own core is a config change (the endpoint), not a rewrite.
 *
 * qurini endpoints ↔ our five MCP tools (contracts/federation-mcp-tools.md):
 *   /search           ↔ find_skills        (per-wish; batching emulated in findSkills.mjs)
 *   /fetch            ↔ get_skill_bundle   (carries `purpose`: hint = read, install = write)
 *   /report_selection ↔ report_selection   (per-wish outcome map, dual-written with the
 *                                           legacy chosen/rejected the endpoint requires)
 *   /report_demand    ↔ emit_demand_pointer (carries the structured sketch)
 *   (no analogue)     ↔ submit_suggestion   (reflection loop — out of this first pass)
 *
 * PRIVACY (constitution Principle IV): callers MUST send only abstracted wishes
 * (description + paraphrased formulations + keywords) and, on a miss, a capability sketch — never the
 * user's plan, brief, output, or any tenant data.
 *
 * Config (env):
 *   SKILLFED_ENDPOINT   hosted API URL (REQUIRED — no local fallback here)
 *   SKILLFED_API_KEY    bearer token (OPTIONAL — qurini's demo is keyless)
 *   SKILLFED_TENANT     tenant id (default from $USER/$USERNAME or 'local')
 */

const TIMEOUT_MS = 15_000;

export const ENDPOINT = (process.env.SKILLFED_ENDPOINT || "").replace(/\/+$/, "");
const API_KEY = process.env.SKILLFED_API_KEY || "";
const TENANT =
  process.env.SKILLFED_TENANT ||
  process.env.USER ||
  process.env.USERNAME ||
  "local";

async function postJSON(path, payload) {
  if (!ENDPOINT) {
    throw new Error(
      "SKILLFED_ENDPOINT is not set — the MCP server is hosted-only and needs a federation URL"
    );
  }
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`; // demo is keyless

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${path}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const OUTCOMES = ["Install", "Read", "Reject"];

/** Canonical spelling of an outcome, or null if it isn't one of the three. */
function canonOutcome(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return OUTCOMES.find((o) => o.toLowerCase() === s) || null;
}

// Near-misses we can still READ, for the legacy projection only. The map keeps whatever word
// the agent used; this table only decides whether that word meant "used it" or "dismissed it",
// so that "Used" / "read it" / "Consulted" cannot collapse into chosen:"None" — which would
// record the exact opposite of what happened (a hard negative for a wish the catalog answered).
const OUTCOME_SYNONYMS = [
  [/^(install(ed)?|adopt(ed)?|sav(e|ed)|kept|keep)\b/, "Install"],
  [/^(read|reading|use[ds]?|useful|consult(ed)?|referenc(e|ed)|applied|help(ed|ful)?|hit)\b/, "Read"],
  [/^(reject(ed)?|dismiss(ed)?|discard(ed)?|skip(ped)?|ignor(e|ed)|irrelevant|unused|no|none|not used)\b/, "Reject"],
];

/** What an outcome LABEL means for the legacy pair — Install|Read|Reject, or null if unreadable. */
function outcomeKind(label) {
  const exact = canonOutcome(label);
  if (exact) return exact;
  const s = String(label ?? "").trim().toLowerCase();
  for (const [re, kind] of OUTCOME_SYNONYMS) if (re.test(s)) return kind;
  return null;
}

/**
 * Coerce the reported map into {skill_id: [outcome, reasoning]}; {} when it is not one.
 *
 * A JSON *string* is parsed before we give up: serializing `outcomes` as a string is an
 * expected mistake, because the sibling `sketch` field is documented over and over as
 * "a STRING, not an object". An unrecognized outcome WORD is passed through verbatim rather
 * than dropped — it is still a label worth recording; deriveLegacy decides separately whether
 * it can be projected onto the old shape.
 */
function normOutcomes(raw) {
  let src = raw;
  if (typeof src === "string") {
    try {
      src = JSON.parse(src);
    } catch {
      return {};
    }
  }
  if (typeof src !== "object" || src === null || Array.isArray(src)) return {};
  const out = {};
  for (const [id, val] of Object.entries(src)) {
    const key = String(id).trim();
    if (!key) continue;
    const pair = Array.isArray(val) ? val : [val];
    const outcome = canonOutcome(pair[0]) || String(pair[0] ?? "").trim();
    if (!outcome) continue;
    out[key] = [outcome, String(pair[1] ?? "").trim()];
  }
  return out;
}

/**
 * Legacy chosen/rejected from the outcome map: chosen = the Install if there was one, else the
 * most useful Read (first wins — the tool description tells the agent to list most-useful-first).
 *
 * Returns NULL when the map cannot be projected — no readable label at all. That state is
 * deliberately DISTINCT from chosen:"None", which asserts "every candidate was genuinely
 * rejected"; conflating them lets an unreadable map record a poisoned hard negative for a wish
 * the catalog may well have answered. "None" is only emitted when every label read as a Reject.
 */
function deriveLegacy(map) {
  const kinds = Object.entries(map).map(([id, [label]]) => [id, outcomeKind(label)]);
  if (!kinds.length) return null;
  const first = (kind) => (kinds.find(([, k]) => k === kind) || [null])[0];
  const chosen = first("Install") || first("Read");
  const rejected = kinds.filter(([, k]) => k === "Reject").map(([id]) => id);
  if (chosen) return { chosen, rejected };
  if (kinds.every(([, k]) => k === "Reject")) return { chosen: "None", rejected };
  return null; // labels present but unreadable — say so rather than claim a total rejection
}

export const federation = {
  tenant: TENANT,

  // Callers always pass an explicit, clamped topN (findSkills.mjs owns the resolution
  // order); this default only matters to direct callers and tracks the same D5 value.
  search(wish, keywords = [], topN = 10) {
    return postJSON("/search", {
      tenant: TENANT,
      wish,
      keywords: keywords || [],
      top_n: topN,
    });
  },

  // `purpose` is "hint" (read it in context) or "install" (write it to disk). The
  // endpoint ignores unknown fields today (verified 2026-07-31: purpose → 200), so we
  // can start recording intent client-side before the service learns to store it.
  fetch(skillId, purpose = "hint") {
    return postJSON("/fetch", { tenant: TENANT, skill_id: skillId, purpose });
  },

  // One wish's outcome, DUAL-WRITTEN. The truth is `outcomes` — every shown candidate
  // mapped to [Install|Read|Reject, why] — because a Read is a hit and the old
  // single-`chosen` shape could not say so. The endpoint still REQUIRES `chosen`
  // (422 without it) and ignores unknown fields, so we derive the legacy pair from the
  // map and send both: this works against today's server unchanged, and the richer map
  // starts being recorded the moment the service stores it. No coordinated release.
  //
  // FAIL CLOSED, never fail wrong: if the map is unreadable (wrong type, unparseable string,
  // empty, or labels we cannot interpret) and no explicit `chosen` overrides it, nothing is
  // sent. Reporting is advisory — index.mjs turns the throw into {reported:false, note} — so a
  // silent chosen:"None" would be strictly worse than not reporting: it teaches the flywheel
  // that every candidate was wrong.
  async reportSelection(queryId, { outcomes = null, chosen = null, rejected = null } = {}) {
    const supplied = outcomes !== null && outcomes !== undefined;
    const map = normOutcomes(outcomes);
    const legacy = deriveLegacy(map);
    const override = (chosen && String(chosen).trim()) || null;

    if (!override && !legacy) {
      throw new Error(
        supplied
          ? 'outcomes was empty or unreadable — expected {"<skill_id>": ["Install"|"Read"|' +
            '"Reject", "<why>"]}; nothing was reported (pass `chosen` to override)'
          : "report_selection needs an `outcomes` map (or an explicit `chosen`); nothing was reported"
      );
    }

    const payload = {
      tenant: TENANT,
      query_id: queryId,
      chosen: override || legacy.chosen,
      rejected: Array.isArray(rejected) ? rejected : legacy ? legacy.rejected : [],
    };
    if (Object.keys(map).length) payload.outcomes = map;
    const res = await postJSON("/report_selection", payload);
    // Sent on the strength of an explicit `chosen`, with the map unusable: say so out loud
    // rather than let the drop pass for a clean report.
    if (supplied && !legacy) {
      return {
        ...res,
        note: Object.keys(map).length
          ? "outcomes carried no readable Install/Read/Reject label; chosen came from your override"
          : "outcomes was empty or unreadable and was dropped; chosen came from your override",
      };
    }
    return res;
  },

  // `wish` is REQUIRED (the searched wish string); `sketch` is an optional STRING
  // (the condensed build spec — see demand-sketch.md). The endpoint rejects an
  // empty wish or a non-string sketch.
  reportDemand(wish, sketch = null) {
    if (!wish || !String(wish).trim()) {
      throw new Error("reportDemand requires a non-empty wish string");
    }
    return postJSON("/report_demand", { tenant: TENANT, wish, sketch });
  },

  // Record a demand pointer on a MISS (empty retrieval OR after rejecting every
  // candidate — see demand-sketch.md). `sketch` may be the canonical fields object
  // or a ready string; an object is serialized to a single-line JSON string,
  // merged with tags/source, and prefixed with "<queryId>: ". The endpoint's
  // `sketch` field is a STRING, so we never send a raw object.
  emitDemandPointer(wish, sketch, queryId = null, tags = [], source = "unmatched_wish") {
    let sketchStr;
    if (sketch && typeof sketch === "object") {
      const obj = { ...sketch };
      if (obj.tags === undefined) obj.tags = tags || [];
      if (obj.source === undefined) obj.source = source;
      sketchStr = JSON.stringify(obj);
    } else {
      sketchStr = sketch == null ? "" : String(sketch);
    }
    if (queryId) sketchStr = `${queryId}: ${sketchStr}`;
    return this.reportDemand(wish, sketchStr);
  },
};
