#!/usr/bin/env python3
"""PostToolUse(ExitPlanMode) hook — TRIGGER the Skill Federation finder.

PRIVACY-CRITICAL CHANGE vs upstream (qurini): this hook NO LONGER reads, stores,
or transmits the plan. The plan/brief must never cross the tenant boundary
(constitution Principle IV). Upstream shipped the entire plan text (≤4000 chars)
to the backend as one `wish` — that is exactly the violation this fork removes.

What it does now: on plan approval it emits a short nudge as `additionalContext`,
telling the agent — which already holds the plan in context — to run the wish-list
finder flow. ALL wish/keyword generation, search, selection, and reporting happen
agent-side via the `skill-federation` skill + `integrations/search_wishlist.py`.
The plan stays in the model's context; it never enters this hook's output.

Hook output protocol (Claude Code):
  print {"hookSpecificOutput": {"hookEventName": "PostToolUse",
         "additionalContext": "..."}} ; exit 0.
Fail-safe: any error → exit 0 (never block the agent).
"""
from __future__ import annotations

import json
import sys

NUDGE = (
    "A plan was just approved. Before executing it, run the **Skill Federation "
    "finder** (skill-federation) to see whether vetted skills already exist:\n"
    "1. From the plan in your context, write a wish-list of UP TO 10 wishes — each "
    "a `{name, description, keywords}` for an ideal skill this plan would use "
    "(\"if every skill existed, which ≤10 would I reach for?\"), with 1–5 evidence "
    "keywords per wish. Do NOT send the plan anywhere — only the wishes cross.\n"
    "2. Run the wishes through `integrations/search_wishlist.py` (it searches all "
    "of them asynchronously and drops anything you already have installed).\n"
    "3. Review the candidates per wish and select the best match or reject all; "
    "present the matches with their license/provenance/trust metadata and get the "
    "user's approval BEFORE installing anything.\n"
    "4. Route outcomes without conflating them: an empty-retrieval wish → a demand "
    "sketch; a wish with candidates you reject → a `selected_id:null` selection label.\n"
    "If nothing relevant is missing, say so briefly and proceed."
)


def _read_payload() -> dict:
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:  # noqa: BLE001
        return {}


def main() -> int:
    payload = _read_payload()
    # Only fire for an actual ExitPlanMode approval. We check that a plan EXISTS
    # to avoid noise, but we never read its contents into our output.
    if payload.get("tool_name") not in (None, "ExitPlanMode"):
        return 0
    ti = payload.get("tool_input") or {}
    has_plan = bool(str(ti.get("plan") or ti.get("Plan") or "").strip())
    if not has_plan:
        return 0
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": NUDGE,
        }
    }))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 — never break the agent
        sys.exit(0)
