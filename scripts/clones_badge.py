#!/usr/bin/env python3
"""Accumulate GitHub clone traffic into a ledger and emit a 'clones' shields endpoint badge.

GitHub only exposes the last 14 days of clone traffic, and the endpoint needs push access. To
show a *cumulative* clones total that keeps growing, we poll regularly and upsert each day's
count into a ledger keyed by date. Re-polling overlapping 14-day windows never double-counts —
the same date is overwritten with its latest authoritative value, and days that age out of the
API window stay in the ledger. Total = sum of every dated count ever observed.

Honesty note: this is CLONES, not installs. Clones are inflated by CI, bots, and mirrors, so it
belongs next to stars as an *interest* signal — never presented as install/usage counts (the
installs badge is the honest usage-ish number). Label it "clones" and nothing else.

Env:
  GH_TRAFFIC_TOKEN   PAT with repo scope (preferred — the built-in GITHUB_TOKEN often 403s here)
  GITHUB_TOKEN       fallback token
  GITHUB_REPOSITORY  "owner/repo" (GitHub Actions sets this); defaults to the constant below

Usage:
  python scripts/clones_badge.py --ledger path/to/clones-ledger.json   # updates ledger in place,
                                                                        # prints badge JSON to stdout
On a fetch failure the existing ledger is preserved and its current total is still emitted, so a
transient 403/outage degrades to last-known rather than zeroing the badge.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error

DEFAULT_REPO = "skill-federation/skill-federation"
COLOR = "8A63D8"
TIMEOUT = 20


def _ledger_path() -> str:
    if "--ledger" in sys.argv:
        return sys.argv[sys.argv.index("--ledger") + 1]
    raise SystemExit("clones_badge.py: --ledger <path> is required")


def _load_ledger(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _fetch_clone_days() -> list[dict] | None:
    """Return the API's per-day clone entries (last 14d), or None on any failure."""
    token = os.environ.get("GH_TRAFFIC_TOKEN") or os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_REPOSITORY") or DEFAULT_REPO
    if not token:
        return None
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/traffic/clones",
        headers={"User-Agent": "skillfed-clones-badge",
                 "Accept": "application/vnd.github+json",
                 "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read()).get("clones", [])
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as e:
        print(f"clones fetch failed ({type(e).__name__}): keeping existing ledger", file=sys.stderr)
        return None


def _humanize(n: int) -> str:
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return f"{n/1000:.1f}k".replace(".0k", "k")
    return f"{n/1_000_000:.1f}M".replace(".0M", "M")


def main() -> int:
    path = _ledger_path()
    ledger = _load_ledger(path)

    days = _fetch_clone_days()
    if days is not None:
        for e in days:
            day = (e.get("timestamp") or "")[:10]   # YYYY-MM-DD
            if day:
                ledger[day] = e.get("count", 0)      # upsert: latest value wins for that date
        with open(path, "w", encoding="utf-8") as f:
            json.dump(dict(sorted(ledger.items())), f, indent=0)
    elif not ledger:
        # fetch failed AND nothing accumulated yet: emit nothing so the caller keeps the
        # previously published (seeded) badge instead of zeroing it.
        print("no clone data and no ledger: leaving existing badge untouched", file=sys.stderr)
        return 1

    total = sum(int(v) for v in ledger.values())
    print(json.dumps({"schemaVersion": 1, "label": "clones",
                      "message": _humanize(total), "color": COLOR}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
