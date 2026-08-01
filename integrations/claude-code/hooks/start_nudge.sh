#!/bin/sh
# skillfed — start-of-plan nudge gate.
#
# Registered as a UserPromptSubmit hook. That event fires on EVERY prompt, so this
# script reads the hook payload from stdin and stays silent unless the session is
# actually in plan mode. Claude Code treats empty stdout as a no-op, so the common
# case costs one grep and prints nothing.
#
# Why a script and not an inline one-liner: the identical command is embedded by
# four installers (install.sh, install.ps1, installer/cli.mjs, python-installer)
# plus hooks.json. Escaping the same quoted grep pattern five different ways is
# how it breaks. Installers just point at this file.
#
# plan_start_nudge.json is copied next to this script by every installer, so the
# nudge is always resolved relative to $0 rather than from a hardcoded path.
#
# Fail-safe: any problem -> exit 0 silently. A hook must never block the agent.

grep -q '"permission_mode"[[:space:]]*:[[:space:]]*"plan"' || exit 0

cat "$(dirname "$0")/plan_start_nudge.json" 2>/dev/null || exit 0

exit 0
