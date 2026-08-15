/**
 * Skill Federation packages client — GET-only, no auth, no tenant.
 *
 * Talks to the PORTAL's package-search endpoint at skillfed.io — a DIFFERENT service
 * from the one federation.mjs calls. find_skills matches wishes against the federated
 * SKILL catalog (qurini's /search, POST, tenant-scoped); find_packages matches wishes
 * against skillfed.io's PACKAGE index (PyPI libraries), a public GET with no tenant and
 * no auth. The response is deliberately shaped so a later swap from the portal to the
 * federation MATCHER seam is invisible to callers — same candidate shape either way.
 *
 * Verified live 2026-08-14: `limit` is clamped 1..25 server-side too (never rejected —
 * 99 comes back as 25, 0 as 1); a missing `q` is a 400 with a JSON error body; the
 * response carries `x-robots-tag: noindex`. No API key, no tenant header.
 *
 * Config (env):
 *   SKILLFED_PACKAGES_ENDPOINT   portal origin to query (default https://skillfed.io)
 */

const TIMEOUT_MS = 15_000;

export const PACKAGES_ENDPOINT = (
  process.env.SKILLFED_PACKAGES_ENDPOINT || "https://skillfed.io"
).replace(/\/+$/, "");

async function getJSON(path, params) {
  const url = new URL(`${PACKAGES_ENDPOINT}${path}`);
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

export const packagesClient = {
  // GET /api/packages/search.json?q=<capability phrase>&limit=<1..25> — public, no auth.
  search(q, limit = 10) {
    return getJSON("/api/packages/search.json", { q, limit });
  },
};
