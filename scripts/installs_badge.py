#!/usr/bin/env python3
"""Compute a single HONEST combined install total (npm + PyPI) as a shields.io endpoint badge.

Why this exists: no off-the-shelf badge sums npm + PyPI, and the only ready-made PyPI *total*
badge (pepy.tech) counts CDN-mirror traffic — it reports ~2.7x the real number. This computes
the honest figure instead:

  npm   = total downloads to date (api.npmjs.org range, summed)
  PyPI  = total downloads WITHOUT mirrors (pypistats overall, `without_mirrors` category)
  badge = npm + PyPI

Output (stdout): a shields.io endpoint schema JSON. A GitHub Action publishes it to the `badges`
branch; the README renders it via
  https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<repo>/badges/installs.json

Honesty notes:
  - "installs" here means downloads-to-date; npm can't separate mirror/CI traffic the way PyPI
    can, so the npm slice is a mild over-count. Still far closer to reality than pepy's mirrored
    total, and we never present the mirror-inflated PyPI figure.
  - pypistats `overall` covers ~180 days. While the package is young this equals all-time; revisit
    if the package ages past that window.

Usage:
  python scripts/installs_badge.py            # print the endpoint JSON
  python scripts/installs_badge.py --verbose  # also print the per-channel breakdown to stderr
"""
from __future__ import annotations

import datetime as _dt
import json
import sys
import urllib.request
import urllib.error

NPM_PACKAGE = "skillfed"
PYPI_PACKAGE = "skillfed"
NPM_START = "2026-06-01"          # a safe lower bound before first publish
COLOR = "2E9E6B"
TIMEOUT = 20


def _get(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": "skillfed-installs-badge"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError):
        return None


def npm_total() -> int | None:
    """Sum daily downloads from NPM_START to today (one range call; window < 18 months)."""
    today = _dt.date.today().isoformat()
    d = _get(f"https://api.npmjs.org/downloads/range/{NPM_START}:{today}/{NPM_PACKAGE}")
    if not d or "downloads" not in d:
        return None
    return sum(x.get("downloads", 0) for x in d["downloads"])


def pypi_total_no_mirrors() -> int | None:
    """Sum the `without_mirrors` category from pypistats overall (excludes CDN mirror traffic)."""
    d = _get(f"https://pypistats.org/api/packages/{PYPI_PACKAGE}/overall")
    if not d or "data" not in d:
        return None
    return sum(r["downloads"] for r in d["data"] if r.get("category") == "without_mirrors")


def _humanize(n: int) -> str:
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return f"{n/1000:.1f}k".replace(".0k", "k")
    return f"{n/1_000_000:.1f}M".replace(".0M", "M")


def main() -> int:
    npm = npm_total()
    pypi = pypi_total_no_mirrors()
    total = (npm or 0) + (pypi or 0)

    if "--verbose" in sys.argv[1:]:
        print(f"npm={npm} pypi_without_mirrors={pypi} combined={total}", file=sys.stderr)

    badge = {
        "schemaVersion": 1,
        "label": "installs",
        "message": _humanize(total),
        "color": COLOR,
    }
    print(json.dumps(badge))
    return 0


if __name__ == "__main__":
    sys.exit(main())
