#!/usr/bin/env python3
"""Async fan-out PACKAGE search — sibling to search_wishlist.py, over a DIFFERENT service.

Skills are capabilities for the agent itself; packages are libraries for the code being
written. `search_wishlist.py` matches wishes against the federated SKILL catalog (qurini's
`/search`, POST, tenant-scoped, via `skillfed_client.py`); this script matches wishes
against skillfed.io's PACKAGE index — the portal's public GET
`/api/packages/search.json`, no tenant, no auth, a distinct ranker over PyPI packages.
Deliberately a separate, simpler client: swapping the portal for a later federation
MATCHER seam is invisible to callers (same response shape either way), same as
`mcp-server/packagesClient.mjs` / `mcp-server/findPackages.mjs`, which this mirrors.

Use this to resolve a package name before `pip install`ing something recalled from
memory — a hallucinated or squatted name is a supply-chain risk this removes for free.

Wish-formulation rules (measured against the live ranker, not vibes):
  - Phrase the TASK, not a package name — the tags lane is weighted 3x and matches task
    vocabulary, so "parse yaml config" outranks guessing "pyyaml".
  - 3-8 dense words; long prose measurably dilutes the match (query crowd-out).
  - One capability per wish; fan a compound need out into separate wishes.
  - Treat license/maintenance/popularity as FILTERS on the returned
    license_treatment/tier fields, not extra query words hoping to steer the ranker.

PRIVACY (constitution Principle IV): only each wish's capability phrase + optional
keywords cross the wire, folded into one `q` string — no file paths, plan text, or repo
identifiers. The wish `name`, if given, is display-only and stays local (same rule as
search_wishlist.py's wish `name`).

`score` is deliberately dropped from every normalized candidate: it's a sum of
1/(60+rank) RRF terms (max ~0.033) and reads as a meaningless decimal, not a signal to
act on.

Usage:
  python search_packages.py wishlist.json
  echo '{"wishlist":[{"description":"parse yaml config"}]}' | python search_packages.py -

Env:
  SKILLFED_PACKAGES_ENDPOINT   portal origin to query (default https://skillfed.io)
  SKILLFED_PKG_LIMIT           candidates returned per wish (default 10, clamped 1-25)
  SKILLFED_PKG_WORKERS         max concurrent wish searches (default 10)

Output (stdout): JSON
  {
    "limit": 10,
    "n_wishes": 2,
    "results": [
      {
        "wish": {"name","description","keywords"},
        "query": "<description + keywords, space-joined>",
        "candidates": [ <normalized, ≤limit> ],
        "count": 0,
        "error": null
      },
      ...
    ]
  }
Exit codes: 0 = ran (per-wish errors are reported inline, never fatal);
            2 = INVALID_PACKAGE_WISHLIST (bad input shape).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PACKAGES_ENDPOINT = os.environ.get("SKILLFED_PACKAGES_ENDPOINT", "https://skillfed.io").rstrip("/")

# The portal clamps `limit` server-side too (verified live 2026-08-14: limit=99 -> 25
# candidates, limit=0 -> 1) — unlike the skill federation's remote, this endpoint never
# 400s on an out-of-range limit. We still clamp client-side so the echoed `limit` matches
# what was actually asked for, and so a junk value doesn't silently ride on whatever the
# server happens to default to. Mirrors _clamp_top_n in search_wishlist.py.
LIMIT_MIN, LIMIT_MAX = 1, 25
LIMIT_FALLBACK = 10


def _clamp_limit(raw, fallback: int = LIMIT_FALLBACK) -> int:
    """Coerce anything (env string, junk, None) into a wire-legal limit."""
    try:
        v = int(float(str(raw).strip()))
    except (TypeError, ValueError):
        return fallback
    return min(LIMIT_MAX, max(LIMIT_MIN, v))


LIMIT = _clamp_limit(os.environ.get("SKILLFED_PKG_LIMIT"))
WORKERS = int(os.environ.get("SKILLFED_PKG_WORKERS", "10"))


def _fail(code: str, detail: str):
    print(json.dumps({"error": code, "detail": detail}))
    sys.exit(2)


def _load_wishlist() -> list[dict]:
    arg = sys.argv[1] if len(sys.argv) > 1 else "-"
    raw = sys.stdin.read() if arg == "-" else open(arg, encoding="utf-8").read()
    try:
        data = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        _fail("INVALID_PACKAGE_WISHLIST", f"not valid JSON: {e}")
    wishlist = data.get("wishlist") if isinstance(data, dict) else data
    if not isinstance(wishlist, list) or not (1 <= len(wishlist) <= 10):
        _fail("INVALID_PACKAGE_WISHLIST", "wishlist must be a list of 1-10 package wishes")
    for i, w in enumerate(wishlist):
        if not isinstance(w, dict):
            _fail("INVALID_PACKAGE_WISHLIST", f"wish {i} is not an object")
        name = (w.get("name") or "").strip()
        desc = (w.get("description") or "").strip()
        kw = [str(k).strip() for k in (w.get("keywords") or []) if str(k).strip()][:5]
        if not desc:
            _fail("INVALID_PACKAGE_WISHLIST", f"wish {i} missing description")
        w["name"], w["description"], w["keywords"] = name, desc, kw
    return wishlist


def _normalize(c: dict) -> dict:
    """portal candidate -> normalized shape (mirrors mcp-server/findPackages.mjs)."""
    return {
        "id": c.get("id"),
        "name": c.get("name"),
        "capability": c.get("capability"),
        "worth_installing": c.get("worth_installing"),
        "license_treatment": c.get("license_treatment"),
        "tier": c.get("tier"),
        "page_url": c.get("page_url"),
        "md_url": c.get("md_url"),
        "json_url": c.get("json_url"),
    }


def _search_one(wish: dict) -> dict:
    """Run one wish's search; never raise — transport errors become `error`."""
    out = {"wish": wish, "query": None, "candidates": [], "count": 0, "error": None}
    # The endpoint takes a single `q` string — fold description + keywords into one
    # space-joined query (dedup, keep order), same term-union approach as find_skills.
    parts = [wish["description"], *wish.get("keywords", [])]
    q = " ".join(dict.fromkeys(p for p in parts if p))
    out["query"] = q
    url = (f"{PACKAGES_ENDPOINT}/api/packages/search.json?"
           f"{urllib.parse.urlencode({'q': q, 'limit': LIMIT})}")
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
            detail = f"{body.get('error', 'error')}: {body.get('detail', '')}".strip()
        except Exception:  # noqa: BLE001
            detail = f"HTTP {e.code} {e.reason}"
        out["error"] = f"{detail} from /api/packages/search.json"
        return out
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    raw = res.get("candidates", []) or []
    out["candidates"] = [_normalize(c) for c in raw][:LIMIT]
    out["count"] = len(out["candidates"])
    return out


def main() -> int:
    wishlist = _load_wishlist()
    workers = max(1, min(WORKERS, len(wishlist)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(_search_one, wishlist))

    print(json.dumps({
        "limit": LIMIT,
        "n_wishes": len(wishlist),
        "results": results,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
