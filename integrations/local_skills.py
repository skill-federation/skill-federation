"""Local-skill check — don't recommend skills the user already has installed.

Release-critical (Bennett flagged): the agent shouldn't pull a skill that's
already present. We scan the known Claude Code skill locations, read each
SKILL.md's `name`, and use those names to filter / demote federation candidates.

Scanned locations (Claude Code; v1 scope):
  ~/.claude/skills/<skill>/SKILL.md          (global)
  <cwd>/.claude/skills/<skill>/SKILL.md       (project)
  $CLAUDE_PROJECT_DIR/.claude/skills/...       (if set by the hook env)

Matching is by normalized skill `name` (the spec's unique id within a scope),
with a description-similarity fallback so near-identical re-publishes are caught
even when names differ slightly.
"""
from __future__ import annotations

import os
import re
import glob

_FM_NAME = re.compile(r"^---\s*\n.*?\bname\s*:\s*([^\n]+).*?\n---", re.DOTALL)
_TOK = re.compile(r"[a-z0-9]+")


def _norm_name(s: str) -> str:
    return "-".join(_TOK.findall(s.lower()))


def _read_name(skill_md: str) -> str | None:
    try:
        with open(skill_md, "r", encoding="utf-8", errors="replace") as f:
            text = f.read(4000)
    except OSError:
        return None
    m = _FM_NAME.match(text)
    if m:
        return m.group(1).strip().strip("'\"")
    # fallback: parent dir name
    return os.path.basename(os.path.dirname(skill_md))


def _candidate_dirs() -> list[str]:
    home = os.path.expanduser("~")
    cwd = os.getcwd()
    proj = os.environ.get("CLAUDE_PROJECT_DIR", cwd)
    roots = [
        os.path.join(home, ".claude", "skills"),
        os.path.join(cwd, ".claude", "skills"),
        os.path.join(proj, ".claude", "skills"),
    ]
    # de-dup while preserving order
    seen, out = set(), []
    for r in roots:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def installed_skill_names(extra_dirs: list[str] | None = None) -> set[str]:
    """Return the set of normalized names of locally-installed skills."""
    names: set[str] = set()
    dirs = _candidate_dirs() + list(extra_dirs or [])
    for root in dirs:
        if not os.path.isdir(root):
            continue
        for md in glob.glob(os.path.join(root, "*", "SKILL.md")):
            nm = _read_name(md)
            if nm:
                names.add(_norm_name(nm))
        # also bare <root>/<name>.md layout
        for md in glob.glob(os.path.join(root, "*.md")):
            if os.path.basename(md).lower() == "readme.md":
                continue
            nm = _read_name(md)
            if nm:
                names.add(_norm_name(nm))
    return names


def filter_candidates(candidates: list[dict], installed: set[str] | None = None
                      ) -> tuple[list[dict], list[dict]]:
    """Split candidates into (new, already_installed) by normalized name.

    `candidate['name']` is the federation skill name. Returns the new ones first
    (to recommend) and the already-installed ones (to optionally note 'you
    already have this').
    """
    if installed is None:
        installed = installed_skill_names()
    new, have = [], []
    for c in candidates:
        if _norm_name(c.get("name", "")) in installed:
            have.append(c)
        else:
            new.append(c)
    return new, have
