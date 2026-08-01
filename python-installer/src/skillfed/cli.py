"""Skill Federation installer — Python tier (`uvx skillfed` / `pipx run skillfed`).

Same curl-tier install as install.sh / install.ps1 / `npx skillfed`, packaged for PyPI so the
smallest-dependency audience (CI, Python shops) can install with no clone and no Node:

    uvx skillfed                  # curl tier, user scope (~/.claude) — no hooks
    uvx skillfed --hook end       # + the end-of-plan nudge (safe settings.json merge)
    uvx skillfed --hook both      # + the start-of-plan nudge as well
    uvx skillfed --with-npx       # + register the npx -y skillfed-mcp MCP server
    uvx skillfed --scope project  # install into ./.claude instead of ~/.claude

Hooks are a per-harness convenience and nothing more — they only repeat triggers the skill
already carries in its own body. The default is ``--hook none``: the skill is complete, and
portable to any harness (or none at all), with no hook registered.

The 6 payload files are vendored into this package (src/skillfed/payload/) by
scripts/vendor-payload.mjs and shipped inside the wheel. When run from a source checkout before
vendoring, we fall back to the canonical copy under integrations/claude-code/. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import stat
import sys
from importlib.resources import files
from pathlib import Path

ENDPOINT_DEFAULT = "https://qurini-skill-federation.hf.space"

# Harnesses we know how to install into -> whether the harness has a hook mechanism at all.
# --hook is rejected for any harness whose value is False.
HARNESSES = {"claude-code": True}
HOOK_MODES = ("none", "start", "end", "both")

# vendored filename -> (dest path under .claude, repo-relative clone-fallback path, +x on POSIX)
PAYLOAD = [
    ("SKILL.md", ("skills", "skill-federation", "SKILL.md"),
     ("skills", "skill-federation", "SKILL.md"), False),
    ("demand-sketch.md", ("skills", "skill-federation", "demand-sketch.md"),
     ("skills", "skill-federation", "demand-sketch.md"), False),
    ("plan_nudge.json", ("skills", "skill-federation", "plan_nudge.json"),
     ("hooks", "plan_nudge.json"), False),
    ("plan_start_nudge.json", ("skills", "skill-federation", "plan_start_nudge.json"),
     ("hooks", "plan_start_nudge.json"), False),
    ("start_nudge.sh", ("skills", "skill-federation", "start_nudge.sh"),
     ("hooks", "start_nudge.sh"), True),
    ("skillfed.md", ("commands", "skillfed.md"),
     ("commands", "skillfed.md"), False),
]

HOOK_EPILOG = (
    "Hooks are a per-harness convenience, not part of the product. They only repeat triggers "
    "the skill already carries in its own body, so the skill works identically with no hook, "
    "in any harness, and with no harness at all. Both nudge files are copied either way, so "
    "switching --hook later never needs a re-fetch."
)


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


def _hook_entries(skill_dir: Path, mode: str) -> list[dict]:
    """The 0-2 settings.json entries implied by a hook mode.

    ``needle`` is the idempotency probe, and each one is a substring of ITS OWN command only:
    the start command names start_nudge.sh, the end command names plan_nudge.json, and neither
    string occurs in the other. (Note that "plan_start_nudge.json" does NOT contain
    "plan_nudge.json" either — re-verify by hand if any of these files is ever renamed.)
    """
    out: list[dict] = []
    if mode in ("start", "both"):
        # The end nudge is curl (ships with Win10+ and macOS). The start nudge is `sh <script>`,
        # and on Windows `sh` exists only with Git Bash. UserPromptSubmit fires on EVERY prompt,
        # so a missing shell there does not degrade once - it fails on every turn. Warn rather
        # than refuse: hooks are optional, and Git Bash can be added later without re-installing.
        if shutil.which("sh") is None:
            sys.stderr.write(
                "WARN: no 'sh' on PATH — the start-of-plan hook runs `sh <script>` and\n"
                "      UserPromptSubmit fires on every prompt, so it would fail on every turn\n"
                "      rather than once. Install Git Bash, or re-run with --hook end.\n"
                "      Registering anyway; the skill itself needs no hook.\n"
            )
        start_abs = str(skill_dir / "start_nudge.sh").replace("\\", "/")
        out.append({
            "label": "start-of-plan nudge",
            "event": "UserPromptSubmit",
            "needle": "start_nudge.sh",
            # No "matcher": UserPromptSubmit carries no tool name to match on. The key is
            # omitted entirely rather than set to null — the script self-gates on
            # permission_mode instead.
            "entry": {"hooks": [{"type": "command", "command": f'sh "{start_abs}"', "timeout": 10}]},
        })
    if mode in ("end", "both"):
        nudge_abs = str(skill_dir / "plan_nudge.json").replace("\\", "/")
        out.append({
            "label": "end-of-plan nudge",
            "event": "PostToolUse",
            "needle": "plan_nudge.json",
            "entry": {
                "matcher": "ExitPlanMode",
                "hooks": [{
                    "type": "command",
                    "command": f'curl -s "file://{nudge_abs}"',
                    "timeout": 20,
                }],
            },
        })
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="skillfed",
        description="Install the Skill Federation finder.",
        epilog=HOOK_EPILOG,
    )
    ap.add_argument("--scope", choices=("user", "project"), default="user")
    ap.add_argument("--target")
    ap.add_argument("--harness", choices=tuple(HARNESSES), default="claude-code",
                    help="target harness (default: claude-code)")
    ap.add_argument("--hook", choices=HOOK_MODES, default=None,
                    help="register 0-2 nudge hooks (default: none)")
    ap.add_argument("--with-hook", action="store_true", help="legacy alias for --hook end")
    ap.add_argument("--with-npx", action="store_true")
    ap.add_argument("--endpoint", default=ENDPOINT_DEFAULT)
    args = ap.parse_args(argv)

    # Resolution order: explicit --hook wins, then the legacy --with-hook switch, then none.
    hook = args.hook if args.hook is not None else ("end" if args.with_hook else "none")
    if hook != "none" and not HARNESSES[args.harness]:
        sys.stderr.write(
            f"error: harness '{args.harness}' has no hook support — drop --hook/--with-hook. "
            "The skill is complete without hooks.\n"
        )
        return 2

    if args.target:
        target = Path(args.target).resolve()
    elif args.scope == "user":
        target = Path.home() / ".claude"
    else:
        target = Path.cwd() / ".claude"

    print("Skill Federation installer (uvx skillfed)")
    print(f"  target : {target}  (scope={args.scope})")
    print(f"  harness: {args.harness}  (hooks: {hook})")
    print()

    # ALWAYS: curl tier (skill + command) — plain file writes, works immediately.
    # Both nudge files and the gate script are copied whatever the hook mode, so switching
    # --hook later is a settings.json edit and never a re-fetch.
    skill_dir = target / "skills" / "skill-federation"
    cmd_dir = target / "commands"
    skill_dir.mkdir(parents=True, exist_ok=True)
    cmd_dir.mkdir(parents=True, exist_ok=True)
    for name, dest_parts, repo_rel, executable in PAYLOAD:
        dest = target.joinpath(*dest_parts)
        dest.write_bytes(_read_payload(name, repo_rel))
        if executable and os.name == "posix":
            try:
                dest.chmod(dest.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            except OSError:
                pass  # non-fatal: the hook is optional anyway
    print("[curl] installed finder skill + /skillfed command (zero runtime)")

    # --hook: register 0-2 nudge entries (safe merge, idempotent, ONE backup before the first write).
    if hook != "none":
        settings = target / "settings.json"
        s = _read_json(settings)
        hooks = s.setdefault("hooks", {})
        backed_up = False
        dirty = False
        for e in _hook_entries(skill_dir, hook):
            arr = hooks.setdefault(e["event"], [])
            already = any(
                e["needle"] in str(h.get("command", ""))
                for x in arr for h in x.get("hooks", [])
            )
            if already:
                print(f"[hook] {e['label']} already registered; skipped")
                continue
            if not backed_up:
                _backup(settings)
                backed_up = True
            arr.append(e["entry"])
            dirty = True
            print(f"[hook] registered {e['label']} ({e['event']}) in settings.json")
        if dirty:
            _write_json(s, settings)

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
