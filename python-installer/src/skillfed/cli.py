"""Skill Federation installer — Python tier (`uvx skillfed` / `pipx run skillfed`).

Same curl-tier install as install.sh / install.ps1 / `npx skillfed`, packaged for PyPI so the
smallest-dependency audience (CI, Python shops) can install with no clone and no Node:

    uvx skillfed                  # curl tier, user scope (~/.claude)
    uvx skillfed --with-hook      # + plan-approval nudge (safe settings.json merge)
    uvx skillfed --with-npx       # + register the npx -y skillfed-mcp MCP server
    uvx skillfed --scope project  # install into ./.claude instead of ~/.claude

The 3 payload files are vendored into this package (src/skillfed/payload/) by
scripts/vendor-payload.mjs and shipped inside the wheel. When run from a source checkout before
vendoring, we fall back to the canonical copy under integrations/claude-code/. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from importlib.resources import files
from pathlib import Path

ENDPOINT_DEFAULT = "https://qurini-skill-federation.hf.space"

# vendored filename -> (dest path under .claude, repo-relative clone-fallback path)
PAYLOAD = [
    ("SKILL.md", ("skills", "skill-federation", "SKILL.md"),
     ("skills", "skill-federation", "SKILL.md")),
    ("plan_nudge.json", ("skills", "skill-federation", "plan_nudge.json"),
     ("hooks", "plan_nudge.json")),
    ("skillfed.md", ("commands", "skillfed.md"),
     ("commands", "skillfed.md")),
]


def _read_payload(name: str, repo_rel: tuple[str, ...]) -> bytes:
    """Bytes of a payload file: the bundled copy if present, else the clone fallback."""
    try:
        # chained single-arg joinpath: multi-arg joinpath is 3.11+, this stays 3.9-safe
        res = files("skillfed").joinpath("payload").joinpath(name)
        if res.is_file():
            return res.read_bytes()
    except (FileNotFoundError, ModuleNotFoundError, OSError):
        pass
    # Clone fallback: <repo>/integrations/claude-code/<repo_rel>
    # cli.py -> skillfed -> src -> python-installer -> <repo root>
    repo = Path(__file__).resolve().parents[3]
    cand = repo.joinpath("integrations", "claude-code", *repo_rel)
    if cand.is_file():
        return cand.read_bytes()
    sys.exit(
        f"error: payload '{name}' not found (bundled or in a clone). "
        "Run scripts/vendor-payload.mjs, or install from the published package."
    )


def _backup(path: Path) -> None:
    if path.exists():
        shutil.copyfile(path, path.with_name(path.name + ".bak"))
        print(f"  backed up -> {path}.bak")


def _read_json(path: Path) -> dict:
    if path.exists() and path.stat().st_size > 0:
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _write_json(obj: dict, path: Path) -> None:
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="skillfed", description="Install the Skill Federation finder.")
    ap.add_argument("--scope", choices=("user", "project"), default="user")
    ap.add_argument("--target")
    ap.add_argument("--with-hook", action="store_true")
    ap.add_argument("--with-npx", action="store_true")
    ap.add_argument("--endpoint", default=ENDPOINT_DEFAULT)
    args = ap.parse_args(argv)

    if args.target:
        target = Path(args.target).resolve()
    elif args.scope == "user":
        target = Path.home() / ".claude"
    else:
        target = Path.cwd() / ".claude"

    print("Skill Federation installer (uvx skillfed)")
    print(f"  target : {target}  (scope={args.scope})")
    print()

    # ALWAYS: curl tier (skill + command) — plain file writes, works immediately.
    skill_dir = target / "skills" / "skill-federation"
    cmd_dir = target / "commands"
    skill_dir.mkdir(parents=True, exist_ok=True)
    cmd_dir.mkdir(parents=True, exist_ok=True)
    for name, dest_parts, repo_rel in PAYLOAD:
        (target.joinpath(*dest_parts)).write_bytes(_read_payload(name, repo_rel))
    print("[curl] installed finder skill + /skillfed command (zero runtime)")

    # --with-hook: register the plan-approval nudge (safe merge + backup, idempotent).
    if args.with_hook:
        nudge_abs = str(skill_dir / "plan_nudge.json").replace("\\", "/")
        cmd = f'curl -s "file://{nudge_abs}"'
        settings = target / "settings.json"
        s = _read_json(settings)
        ptu = s.setdefault("hooks", {}).setdefault("PostToolUse", [])
        already = any(
            "plan_nudge.json" in str(h.get("command", ""))
            for e in ptu for h in e.get("hooks", [])
        )
        if already:
            print("[hook] already registered; skipped")
        else:
            _backup(settings)
            ptu.append({
                "matcher": "ExitPlanMode",
                "hooks": [{"type": "command", "command": cmd, "timeout": 20}],
            })
            _write_json(s, settings)
            print("[hook] registered plan-approval nudge in settings.json")

    # --with-npx: register the published Node MCP server (project-scoped .mcp.json).
    if args.with_npx:
        mcp = Path.cwd() / ".mcp.json"
        m = _read_json(mcp)
        _backup(mcp)
        m.setdefault("mcpServers", {})["skillfed-mcp"] = {
            "command": "npx",
            "args": ["-y", "skillfed-mcp"],
            "env": {"SKILLFED_ENDPOINT": args.endpoint},
        }
        _write_json(m, mcp)
        print(f"[npx] registered Node MCP server -> {mcp} (npx -y skillfed-mcp)")

    print()
    print("Done. Restart Claude Code, then run:  /skillfed <what you're trying to do>")
    print(f"Endpoint: {args.endpoint}  (override with $SKILLFED_ENDPOINT)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
