#!/usr/bin/env python3
"""Async fan-out search helper — the tenant-side `find_skills` adapter.

This is the privacy-preserving replacement for upstream's "dump the whole plan as
one wish". The agent (Claude Code session) produces a WISH-LIST first — 1–10 wishes,
each `{name, description, keywords[1–5], formulations[K paraphrases]}` (data-model.md
Wish, Principle I) — and this helper runs ONE search PER WISH, CONCURRENTLY, then
normalizes + de-dupes the results.

Per-wish query = the display `description` + up to K paraphrased `formulations`
concatenated into ONE BM25 query. BM25 is bag-of-words, so concatenation is a
term-union "expected-response sketch" (SIRA) — empirically it matches a K-request
RRF ensemble on recall@3 at 1/K the cost, no fusion. The one-liner `description`
stays human-facing (the wish→match table); the formulations carry the lexical recall.

The spec's `find_skills` takes the whole wish-list in one batched call; qurini's hosted
demo only exposes a per-wish `/search`, so we emulate the batch by fanning out async
across WISHES (ThreadPoolExecutor — `urllib` is blocking). Swap `SKILLFED_ENDPOINT`
to our own federation core later and this same helper keeps working (the client seam).

PRIVACY (constitution Principle IV): only each wish's name/description/keywords cross
the boundary. The plan, brief, outputs, and reasoning trace never do — they are not
even passed to this script.

Usage:
  python search_wishlist.py wishlist.json
  echo '{"wishlist":[{"name":"...","description":"...","keywords":["..."]}]}' | python search_wishlist.py -

Env:
  SKILLFED_ENDPOINT  hosted federation URL (unset → local core via skillfed_client)
  SKILLFED_TOP_N     candidates returned per wish (default 3 — spec default k)
  SKILLFED_K         paraphrase formulations concatenated into each query (default 4)
  SKILLFED_WORKERS   max concurrent wish searches (default 10)

Output (stdout): JSON
  {
    "endpoint_mode": "hosted" | "local",
    "top_n": 3,
    "paraphrases_k": 4,
    "n_wishes": 4,
    "results": [
      {
        "wish": {"name","description","keywords","formulations"},
        "query_id": "q_...",            # preserved for per-wish report_selection
        "query_text": "<description + formulations, concatenated>",
        "candidates": [ <normalized, deduped, ≤top_n> ],
        "already_installed": ["name", ...],
        "empty": false,                  # TRUE only on genuine empty retrieval → demand
        "error": null                    # transport error (≠ empty; do NOT emit demand)
      },
      ...
    ]
  }
Exit codes: 0 = ran (per-wish errors are reported inline, never fatal);
            2 = INVALID_WISHLIST (bad input shape).
"""
from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

# integrations/ (this file's dir) on path for the shared client + local-skill check
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from skillfed_client import SkillfedClient, ENDPOINT  # noqa: E402
from local_skills import installed_skill_names, filter_candidates  # noqa: E402

TOP_N = int(os.environ.get("SKILLFED_TOP_N", "3"))  # candidates returned per wish
K = int(os.environ.get("SKILLFED_K", "4"))          # paraphrase formulations concatenated per query
WORKERS = int(os.environ.get("SKILLFED_WORKERS", "10"))


def _fail(code: str, detail: str):
    print(json.dumps({"error": code, "detail": detail}))
    sys.exit(2)


def _load_wishlist() -> list[dict]:
    arg = sys.argv[1] if len(sys.argv) > 1 else "-"
    raw = sys.stdin.read() if arg == "-" else open(arg, encoding="utf-8").read()
    try:
        data = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        _fail("INVALID_WISHLIST", f"not valid JSON: {e}")
    wishlist = data.get("wishlist") if isinstance(data, dict) else data
    if not isinstance(wishlist, list) or not (1 <= len(wishlist) <= 10):
        _fail("INVALID_WISHLIST", "wishlist must be a list of 1–10 wishes")
    for i, w in enumerate(wishlist):
        if not isinstance(w, dict):
            _fail("INVALID_WISHLIST", f"wish {i} is not an object")
        name = (w.get("name") or "").strip()
        desc = (w.get("description") or "").strip()
        kw = [k.strip() for k in (w.get("keywords") or []) if str(k).strip()]
        forms = [str(f).strip() for f in (w.get("formulations") or []) if str(f).strip()]
        if not name or not desc:
            _fail("INVALID_WISHLIST", f"wish {i} missing name/description")
        if not (1 <= len(kw) <= 5):
            _fail("INVALID_WISHLIST",
                  f"wish {i} needs 1–5 keywords (got {len(kw)}) — keyword "
                  "generation is part of the ask, not optional")
        w["name"], w["description"], w["keywords"] = name, desc, kw
        w["formulations"] = forms[:K]  # cap at K paraphrases; empty → description-only
    return wishlist


def _normalize(c: dict) -> dict:
    """qurini candidate → spec-ish candidate shape."""
    t = c.get("trust") or {}
    return {
        "id": c.get("skill_id") or c.get("id"),
        "name": c.get("name"),
        "description": c.get("description", ""),
        "score": c.get("score"),
        "status": c.get("status", "real"),
        "origin": c.get("origin"),
        "trust": {
            "license": t.get("license"),
            "license_class": t.get("license_class", "review"),
            "provenance": t.get("provenance", "unverified"),
            "stars": t.get("stars"),
        },
        "security_flags": c.get("security_flags", []),
        "source_url": c.get("source_url"),
    }


def _search_one(wish: dict, installed: set[str]) -> dict:
    """Run one wish's search; never raise — transport errors become `error`."""
    out = {"wish": wish, "query_id": None, "query_text": None, "candidates": [],
           "already_installed": [], "empty": False, "error": None}
    # BM25 is bag-of-words: concatenate display description + up to K paraphrased
    # formulations into ONE term-union query (matches a K-request RRF ensemble at 1/K
    # the cost). keywords ride along (@0.5 server-side).
    parts = [wish["description"], *wish.get("formulations", [])]
    query_text = " ".join(dict.fromkeys(p for p in parts if p))  # dedup, keep order
    out["query_text"] = query_text
    try:
        res = SkillfedClient().search(query_text, keywords=wish["keywords"], top_n=TOP_N)
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    out["query_id"] = res.get("query_id")
    raw = res.get("candidates", []) or []
    out["empty"] = len(raw) == 0  # genuine empty retrieval → demand-pointer case
    norm = [_normalize(c) for c in raw]
    new, have = filter_candidates(norm, installed)
    out["candidates"] = new[:TOP_N]
    out["already_installed"] = [h.get("name") for h in have]
    # adapter extras qurini provides (not in spec; aid the agent's selection)
    for extra in ("confidence", "recommendation"):
        if extra in res:
            out[extra] = res[extra]
    return out


def main() -> int:
    wishlist = _load_wishlist()
    try:
        installed = installed_skill_names()
    except Exception:  # noqa: BLE001
        installed = set()

    workers = max(1, min(WORKERS, len(wishlist)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda w: _search_one(w, installed), wishlist))

    print(json.dumps({
        "endpoint_mode": "hosted" if ENDPOINT else "local",
        "top_n": TOP_N,
        "paraphrases_k": K,
        "n_wishes": len(wishlist),
        "results": results,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
