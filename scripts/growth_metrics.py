#!/usr/bin/env python3
"""Privacy-preserving growth dashboard for Skill Federation.

North star = weekly SERVED SEARCHES; weekly installs are the leading indicator. This script
pulls ONLY public, aggregate signals (package downloads, repo traffic) — the same privacy floor
the product itself holds. It never tracks a user, never phones home from a client, and sends
nothing anywhere: it just reads public counters and prints them.

Sources
  - npm downloads      api.npmjs.org           (public, no auth)  — packages `skillfed`, `skillfed-mcp`
  - PyPI downloads     pypistats.org           (public, no auth)  — package `skillfed`
  - GitHub stars/forks api.github.com          (public, no auth)
  - GitHub traffic     api.github.com/.../traffic (needs a token) — views + unique clones
  - served searches    <your federation>       (server-side counter — NOT a client metric; see note)

Usage
  python scripts/growth_metrics.py            # human table
  python scripts/growth_metrics.py --json     # machine-readable, for a dashboard cron

Env
  GITHUB_TOKEN   optional PAT (repo scope) to unlock the traffic API (views/clones).
                 Without it, stars/forks still work; traffic is skipped.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error

REPO = "skill-federation/skill-federation"
NPM_PACKAGES = ("skillfed", "skillfed-mcp")
PYPI_PACKAGE = "skillfed"
TIMEOUT = 15


def _get(url: str, headers: dict | None = None) -> dict | None:
    """GET JSON; return None on any transport/HTTP error (never raise — one dead source
    must not blank the whole dashboard)."""
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "skillfed-metrics"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError):
        return None


def npm_last_week() -> dict:
    """Weekly downloads per npm package (leading indicator: installs)."""
    out = {}
    for pkg in NPM_PACKAGES:
        d = _get(f"https://api.npmjs.org/downloads/point/last-week/{pkg}")
        out[pkg] = (d or {}).get("downloads")
    return out


def pypi_recent() -> dict:
    """Recent PyPI downloads (last day/week/month) for the wheel."""
    d = _get(f"https://pypistats.org/api/packages/{PYPI_PACKAGE}/recent")
    return (d or {}).get("data", {})


def github_repo() -> dict:
    """Public repo signals — stars/forks/open issues (secondary optics)."""
    d = _get(f"https://api.github.com/repos/{REPO}",
             headers={"User-Agent": "skillfed-metrics", "Accept": "application/vnd.github+json"})
    if not d:
        return {}
    return {"stars": d.get("stargazers_count"), "forks": d.get("forks_count"),
            "open_issues": d.get("open_issues_count")}


def github_traffic() -> dict:
    """Views + unique clones over the last 14 days. Requires GITHUB_TOKEN (repo scope)."""
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return {"error": "no GITHUB_TOKEN - traffic skipped (stars/forks still shown)"}
    h = {"User-Agent": "skillfed-metrics", "Accept": "application/vnd.github+json",
         "Authorization": f"Bearer {token}"}
    views = _get(f"https://api.github.com/repos/{REPO}/traffic/views", headers=h) or {}
    clones = _get(f"https://api.github.com/repos/{REPO}/traffic/clones", headers=h) or {}
    return {"views_14d": views.get("count"), "unique_visitors_14d": views.get("uniques"),
            "clones_14d": clones.get("count"), "unique_cloners_14d": clones.get("uniques")}


def collect() -> dict:
    return {
        "north_star": {
            "served_searches_weekly": None,
            "note": "Server-side counter at your federation endpoint. Not a client metric "
                    "(clients send only abstract wishes). Wire this to the endpoint's request log.",
        },
        "installs_leading": {"npm_last_week": npm_last_week(), "pypi_recent": pypi_recent()},
        "repo": github_repo(),
        "traffic": github_traffic(),
    }


def _print_table(m: dict) -> None:
    print("Skill Federation - growth snapshot\n" + "=" * 38)
    ns = m["north_star"]
    print(f"\nNORTH STAR  served searches / week : {ns['served_searches_weekly'] or 'TODO (server-side)'}")
    print(f"            note: {ns['note']}")
    print("\nINSTALLS (leading indicator)")
    for pkg, n in m["installs_leading"]["npm_last_week"].items():
        print(f"  npm  {pkg:14} last week : {n if n is not None else 'n/a'}")
    pypi = m["installs_leading"]["pypi_recent"]
    if pypi:
        print(f"  pypi {PYPI_PACKAGE:14} day/week/month : "
              f"{pypi.get('last_day','?')}/{pypi.get('last_week','?')}/{pypi.get('last_month','?')}")
    else:
        print(f"  pypi {PYPI_PACKAGE:14} : n/a")
    r = m["repo"]
    print("\nREPO (secondary optics)")
    print(f"  stars {r.get('stars','n/a')}  forks {r.get('forks','n/a')}  open issues {r.get('open_issues','n/a')}")
    t = m["traffic"]
    print("\nTRAFFIC (last 14d)")
    if t.get("error"):
        print(f"  {t['error']}")
    else:
        print(f"  views {t.get('views_14d','?')} ({t.get('unique_visitors_14d','?')} unique)  "
              f"clones {t.get('clones_14d','?')} ({t.get('unique_cloners_14d','?')} unique)")


def main() -> int:
    m = collect()
    if "--json" in sys.argv[1:]:
        print(json.dumps(m, indent=2))
    else:
        _print_table(m)
    return 0


if __name__ == "__main__":
    sys.exit(main())
