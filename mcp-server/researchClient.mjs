/**
 * Skill Federation research client — GET-only, no auth, no tenant.
 *
 * Talks to the PORTAL's research-search endpoint at skillfed.io — a DIFFERENT service from
 * the one federation.mjs calls, and a sibling to packagesClient.mjs (same host, same GET/no-auth
 * shape, different index). find_skills matches wishes against the federated SKILL catalog
 * (qurini's /search, POST, tenant-scoped); find_research matches wishes against skillfed.io's
 * RESEARCH index — 191 research notes over agent-skills literature, a public GET with no tenant
 * and no auth.
 *
 * Verified live 2026-08-16: `limit` is clamped 1..25 server-side too (never rejected — 99 comes
 * back as 25, 0 as 1); a missing `q` is a 400 with a JSON error body; the response carries a
 * top-level `confidence: "strong"|"weak"` plus a `note` field present ONLY when confidence is
 * "weak" (absent, not null, on a strong match). No API key, no tenant header.
 *
 * A path-route twin exists at GET /api/research-q/<wish> (same corpus, URL-embedded query, for
 * clients that can't send a query string) — this client uses the JSON search endpoint only, the
 * same choice packagesClient.mjs made for /api/packages/search.json.
 *
 * Config (env):
 *   SKILLFED_RESEARCH_ENDPOINT   portal origin to query (default https://skillfed.io)
 */

const TIMEOUT_MS = 15_000;

export const RESEARCH_ENDPOINT = (
  process.env.SKILLFED_RESEARCH_ENDPOINT || "https://skillfed.io"
).replace(/\/+$/, "");

async function getJSON(path, params) {
  const url = new URL(`${RESEARCH_ENDPOINT}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // non-JSON body (rare — a 5xx from an edge/proxy); fall through to the status check
    }
    if (!res.ok) {
      const detail =
        body && (body.detail || body.error)
          ? `${body.error || "error"}${body.detail ? `: ${body.detail}` : ""}`
          : `HTTP ${res.status} ${res.statusText}`;
      throw new Error(`${detail} from ${path}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export const researchClient = {
  // GET /api/research/search.json?q=<topic phrase>&limit=<1..25> — public, no auth.
  search(q, limit = 10) {
    return getJSON("/api/research/search.json", { q, limit });
  },
};
