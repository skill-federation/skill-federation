#!/usr/bin/env python3
"""Async fan-out search helper — the tenant-side `find_skills` adapter.

This is the privacy-preserving replacement for upstream's "dump the whole plan as
one wish". The agent (Claude Code session) produces a WISH-LIST first — 1–10 wishes,
each `{name, description, keywords[1–5], formulations[K paraphrases]}` (data-model.md
Wish, Principle I) — and this helper runs ONE search PER WISH, CONCURRENTLY, then
normalizes + de-dupes the results.

Per-wish query = the display `description` + up to K paraphrased `formulations` +
the flattened structured `sketch` (SIRA's expected-response sketch — purpose / inputs /
outputs / operations / domain_vocab / section_sketch / tags), all concatenated into ONE
BM25 query. BM25 is bag-of-words, so concatenation is a term-union query — empirically it
matches a K-request RRF ensemble on recall@3 at 1/K the cost, no fusion. The one-liner
`description` stays human-facing (the wish→match table); the formulations carry lexical
recall; the sketch supplies the rare, discriminative vocabulary a matching SKILL.md would
contain (this is SIRA step iii — the full sketch vocabulary in the single weighted query,
not the 1–5-keyword sliver the earlier design reserved for the failure path). The same
structured `sketch` rides on the wish so the miss path emits it as the demand pointer with
no re-derivation (demand-sketch.md).

NOTE (tradeoff): appended sketch terms ride in the `wish` field at the server's wish weight
(1.0), not SIRA's 0.5 expansion lane, because the hosted demo's only weight-1.0 channel is
`wish`. When we own the server, move sketch vocab to the 0.5 lane + df-prune. Keep the
sketch terse (domain_vocab-heavy) to avoid diluting precision.

The spec's `find_skills` takes the whole wish-list in one batched call; qurini's hosted
demo only exposes a per-wish `/search`, so we emulate the batch by fanning out async
across WISHES (ThreadPoolExecutor — `urllib` is blocking). Swap `SKILLFED_ENDPOINT`
to our own federation core later and this same helper keeps working (the client seam).

PRIVACY (constitution Principle IV): each wish's description, its paraphrased
formulations, keywords, AND its structured capability sketch cross the boundary on every
search (name is display-only and stays local). Every field stays at the "what skill should
exist" abstraction — the same floor as a wish. The plan, brief, outputs, and reasoning
trace never cross — they are not even passed to this script.

Usage:
  python search_wishlist.py wishlist.json
  echo '{"wishlist":[{"name":"...","description":"...","keywords":["..."]}]}' | python search_wishlist.py -

Env:
  SKILLFED_ENDPOINT  hosted federation URL (unset → local core via skillfed_client)
  SKILLFED_TOP_N     candidates returned per wish (default 5)
  SKILLFED_K         paraphrase formulations concatenated into each query (default 4)
  SKILLFED_WORKERS   max concurrent wish searches (default 10)

Output (stdout): JSON
  {
    "endpoint_mode": "hosted" | "local",
    "top_n": 5,
    "paraphrases_k": 4,
    "n_wishes": 4,
    "results": [
      {
        "wish": {"name","description","keywords","formulations","sketch"},
        "query_id": "q_...",            # preserved for per-wish report_selection
        "query_text": "<description + formulations + flattened sketch, concatenated>",
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

TOP_N = int(os.environ.get("SKILLFED_TOP_N", "5"))  # candidates returned per wish
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
        w["sketch"] = _norm_sketch(w.get("sketch"))  # optional; {} → behaves like today
    return wishlist


# Structured expected-response sketch (SIRA step i) — the demand-sketch.md schema.
# Optional on the wire: a wish with no sketch reproduces the pre-sketch query exactly.
_SKETCH_STR_FIELDS = ("purpose", "section_sketch")
_SKETCH_LIST_FIELDS = ("inputs", "outputs", "operations", "domain_vocab", "tags")


def _norm_sketch(raw) -> dict:
    """Coerce a wish's `sketch` into the canonical shape; non-dict/empty → {}."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for f in _SKETCH_STR_FIELDS:
        v = (raw.get(f) or "")
        if isinstance(v, str) and v.strip():
            out[f] = v.strip()
    for f in _SKETCH_LIST_FIELDS:
        vals = [str(x).strip() for x in (raw.get(f) or []) if str(x).strip()]
        if vals:
            out[f] = vals
    return out


def _flatten_sketch(sketch: dict) -> list[str]:
    """Sketch → flat list of term-phrases for the bag-of-words query (values only, no
    JSON keys/punctuation). domain_vocab/operations first — the discriminative vocab SIRA
    rewards; purpose/section_sketch/tags trail. Order only affects dedup precedence."""
    if not sketch:
        return []
    parts: list[str] = []
    parts.extend(sketch.get("domain_vocab", []))
    parts.extend(sketch.get("operations", []))
    parts.extend(sketch.get("inputs", []))
    parts.extend(sketch.get("outputs", []))
    if sketch.get("purpose"):
        parts.append(sketch["purpose"])
    if sketch.get("section_sketch"):
        parts.append(sketch["section_sketch"])
    parts.extend(sketch.get("tags", []))
    return [p for p in parts if p]


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
    # formulations + the flattened structured sketch (SIRA step iii — the full
    # expected-response vocabulary in the single weighted query) into ONE term-union
    # query (matches a K-request RRF ensemble at 1/K the cost). keywords ride along
    # (@0.5 server-side); appended sketch terms ride at wish weight (1.0) — see module docstring.
    parts = [wish["description"], *wish.get("formulations", []),
             *_flatten_sketch(wish.get("sketch", {}))]
    query_text = " ".join(dict.fromkeys(p for p in parts if p))  # dedup, keep order
    out["query_text"] = query_text
    try:
        res = SkillfedClient().search(query_text, keywords=wish["keywords"], top_n=TOP_N)
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
        return out
    out["query_id"] = res.get("query_id")
    raw = res.get("candidates", []) or []
    out["empty"] = len(raw) == 0  # empty retrieval → demand pointer (so can all-rejected, later)
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
