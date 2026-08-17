#!/usr/bin/env python3
"""Async fan-out RESEARCH search — sibling to search_packages.py, over a DIFFERENT index.

Skills are capabilities for the agent itself; packages are libraries for the code being
written; research is the literature underneath both. This script matches wishes against
skillfed.io's RESEARCH index — the portal's public GET `/api/research/search.json`, no
tenant, no auth — over 191 research notes on agent-skills literature. Deliberately a
separate, simple client, the same shape as `search_packages.py`: no dependency on
`skillfed_client.py`, which is specific to the skill federation, mirroring
`mcp-server/researchClient.mjs` / `mcp-server/findResearch.mjs`.

Every candidate has a published `/research/{slug}` page, unlike skills (~98% unpublished) —
so `page_url` is always a working link, never a dead one.

CONFIDENCE — surfaced, read honestly. Each search returns a top-level `confidence`:
"strong" or "weak", plus a `note` when weak. "weak" means the best match FOUND is a loose
one — it is NOT proof the corpus was searched exhaustively and this is the closest thing
that exists. Discount a weak result; do not treat it as evidence of absence.

KNOWN RETRIEVAL LIMIT — a paraphrase with no lexical overlap AND weak embedding similarity
can miss the corpus entirely, measured at rank #67 of 191 on a real query. No confidence
label fixes that: the label describes a candidate that WAS returned, and cannot rescue a
note that never entered the top-k. An empty or weak result does NOT prove no such research
exists.

Wish-formulation rules (measured against the live ranker's field weights, not vibes):
  - The index weights concept_terms 3.0 / paper_title 2.5 / meta_description 1.5 /
    claim_title 0.75. concept_terms is CONTROLLED VOCABULARY (e.g. "automatic curriculum",
    "skill library", "self-verification"), so topic/concept phrasing beats guessing a paper
    name.
  - 3-8 dense words; long prose measurably dilutes the match (same crowd-out
    search_packages.py documents).
  - One topic per wish; fan a compound need out into separate wishes.

PRIVACY (constitution Principle IV): only each wish's topic phrase + optional keywords
cross the wire, folded into one `q` string — no file paths, plan text, or repo
identifiers. The wish `name`, if given, is display-only and stays local (same rule as
search_packages.py's wish `name`).

`score` is deliberately dropped from every normalized candidate: it's a sum of
1/(60+rank) RRF terms (max ~0.033) and reads as a meaningless decimal, not a signal to
act on. `confidence` is a label about match quality, not a score, and IS kept.

Usage:
  python search_research.py wishlist.json
  echo '{"wishlist":[{"description":"automatic curriculum generation"}]}' | python search_research.py -

Env:
  SKILLFED_RESEARCH_ENDPOINT   portal origin to query (default https://skillfed.io)
  SKILLFED_RESEARCH_LIMIT      candidates returned per wish (default 10, clamped 1-25)
  SKILLFED_RESEARCH_WORKERS    max concurrent wish searches (default 10)

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
        "confidence": "strong" | "weak" | null,
        "note": "<present only when confidence is weak>" | null,
        "error": null
      },
      ...
    ]
  }
Exit codes: 0 = ran (per-wish errors are reported inline, never fatal);
            2 = INVALID_RESEARCH_WISHLIST (bad input shape).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RESEARCH_ENDPOINT = os.environ.get("SKILLFED_RESEARCH_ENDPOINT", "https://skillfed.io").rstrip("/")

# The portal clamps `limit` server-side too (verified live 2026-08-16: limit=99 -> 25
# candidates, limit=0 -> 1) — this endpoint never 400s on an out-of-range limit either. We
# still clamp client-side so the echoed `limit` matches what was actually asked for, and so
# a junk value doesn't silently ride on whatever the server happens to default to. Mirrors
# _clamp_limit in search_packages.py.
LIMIT_MIN, LIMIT_MAX = 1, 25
LIMIT_FALLBACK = 10


def _clamp_limit(raw, fallback: int = LIMIT_FALLBACK) -> int:
    """Coerce anything (env string, junk, None) into a wire-legal limit."""
    try:
        v = int(float(str(raw).strip()))
    except (TypeError, ValueError):
        return fallback
    return min(LIMIT_MAX, max(LIMIT_MIN, v))


LIMIT = _clamp_limit(os.environ.get("SKILLFED_RESEARCH_LIMIT"))
WORKERS = int(os.environ.get("SKILLFED_RESEARCH_WORKERS", "10"))


def _fail(code: str, detail: str):
    print(json.dumps({"error": code, "detail": detail}))
    sys.exit(2)


def _load_wishlist() -> list[dict]:
    arg = sys.argv[1] if len(sys.argv) > 1 else "-"
    raw = sys.stdin.read() if arg == "-" else open(arg, encoding="utf-8").read()
    try:
        data = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        _fail("INVALID_RESEARCH_WISHLIST", f"not valid JSON: {e}")
    wishlist = data.get("wishlist") if isinstance(data, dict) else data
    if not isinstance(wishlist, list) or not (1 <= len(wishlist) <= 10):
        _fail("INVALID_RESEARCH_WISHLIST", "wishlist must be a list of 1-10 research wishes")
    for i, w in enumerate(wishlist):
        if not isinstance(w, dict):
            _fail("INVALID_RESEARCH_WISHLIST", f"wish {i} is not an object")
        name = (w.get("name") or "").strip()
        desc = (w.get("description") or "").strip()
        kw = [str(k).strip() for k in (w.get("keywords") or []) if str(k).strip()][:5]
        if not desc:
            _fail("INVALID_RESEARCH_WISHLIST", f"wish {i} missing description")
        w["name"], w["description"], w["keywords"] = name, desc, kw
    return wishlist


def _normalize(c: dict) -> dict:
    """portal candidate -> normalized shape (mirrors mcp-server/findResearch.mjs)."""
    return {
        "id": c.get("id"),
        "paper_title": c.get("paper_title"),
        "claim_title": c.get("claim_title"),
        "meta_description": c.get("meta_description"),
        "page_url": c.get("page_url"),
    }


def _search_one(wish: dict) -> dict:
    """Run one wish's search; never raise — transport errors become `error`."""
    out = {
        "wish": wish, "query": None, "candidates": [], "count": 0,
        "confidence": None, "note": None, "error": None,
    }
    # The endpoint takes a single `q` string — fold description + keywords into one
    # space-joined query (dedup, keep order), same term-union approach as search_packages.py.
    parts = [wish["description"], *wish.get("keywords", [])]
    q = " ".join(dict.fromkeys(p for p in parts if p))
    out["query"] = q
    url = (f"{RESEARCH_ENDPOINT}/api/research/search.json?"
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
        out["error"] = f"{detail} from /api/research/search.json"
        return out
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    raw = res.get("candidates", []) or []
    out["candidates"] = [_normalize(c) for c in raw][:LIMIT]
    out["count"] = len(out["candidates"])
    # confidence is always present on a successful response; note only when confidence is
    # "weak" (absent, not null, on the wire) — normalize its absence to None.
    out["confidence"] = res.get("confidence")
    out["note"] = res.get("note")
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
