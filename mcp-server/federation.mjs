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
 *   /fetch            ↔ get_skill_bundle
 *   /report_selection ↔ report_selection   (per-wish: chosen + rejected ids)
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

export const federation = {
  tenant: TENANT,

  search(wish, keywords = [], topN = 6) {
    return postJSON("/search", {
      tenant: TENANT,
      wish,
      keywords: keywords || [],
      top_n: topN,
    });
  },

  fetch(skillId) {
    return postJSON("/fetch", { tenant: TENANT, skill_id: skillId });
  },

  // One wish's agentic-selection outcome. chosen = selected id, or the literal
  // string "None" when every candidate was rejected (the endpoint requires a
  // non-empty chosen). rejected = the other shown candidate ids.
  reportSelection(queryId, chosen, rejected = []) {
    const chosenVal = chosen && String(chosen).trim() ? chosen : "None";
    return postJSON("/report_selection", {
      tenant: TENANT,
      query_id: queryId,
      chosen: chosenVal,
      rejected: rejected || [],
    });
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
