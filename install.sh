#!/usr/bin/env bash
# Skill Federation - installer (macOS / Linux)
#
# Auto-detects what's on the machine and installs the right tier:
#   ALWAYS        : the curl-based finder (skill + /skillfed command) - zero runtime, just curl.
#   --with-hook   : register the plan-approval nudge in settings.json (safe merge + backup).
#   --with-npx    : also register the Node MCP server (requires node) for typed-tool ergonomics.
#   --with-python : print the advanced/CI Python-helper setup.
#
# JSON edits (hook / npx) use python3 if present - with a printed paste-in fallback if not.
# The RUNTIME path needs only curl; python here is an install-time convenience.
#
# Examples:
#   ./install.sh                 # curl tier, user scope (~/.claude)
#   ./install.sh --with-hook     # + auto-trigger after plan approval
#   ./install.sh --with-npx      # + Node MCP tools (if node present)
#   ./install.sh --scope project # install into ./.claude instead of ~/.claude
set -euo pipefail

# SCRIPT_DIR is the checkout when run from a clone; empty when piped (curl … | bash → no file
# on disk). Empty auto-selects remote mode, fetching each payload file from $RAW_BASE.
SRC0="${BASH_SOURCE:-$0}"
if [ -f "$SRC0" ]; then SCRIPT_DIR="$(cd "$(dirname "$SRC0")" && pwd)"; else SCRIPT_DIR=""; fi

# Raw GitHub base for no-clone fetches; also the tail of each repo-root-relative payload path.
RAW_BASE="https://raw.githubusercontent.com/skill-federation/skill-federation/main"
PAYLOAD0="integrations/claude-code/skills/skill-federation/SKILL.md"

SCOPE=user; TARGET=""; WITH_HOOK=0; WITH_NPX=0; WITH_PYTHON=0
ENDPOINT="https://qurini-skill-federation.hf.space"
while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE="$2"; shift 2;;
    --target) TARGET="$2"; shift 2;;
    --with-hook) WITH_HOOK=1; shift;;
    --with-npx) WITH_NPX=1; shift;;
    --with-python) WITH_PYTHON=1; shift;;
    --endpoint) ENDPOINT="$2"; shift 2;;
    --raw-base) RAW_BASE="$2"; shift 2;;
    *) echo "unknown arg: $1"; exit 2;;
  esac
done

REMOTE_MODE=1; [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/$PAYLOAD0" ] && REMOTE_MODE=0
# resolve_source <repo-relative-path> <dest>: copy from the clone, else fetch from raw GitHub.
resolve_source() {
  if [ "$REMOTE_MODE" = 0 ]; then
    cp "$SCRIPT_DIR/$1" "$2"
  else
    curl -fsSL "$RAW_BASE/$1" -o "$2" || { echo "fetch failed: $RAW_BASE/$1" >&2; exit 1; }
    echo "  fetched <- $1"
  fi
}
[ -n "$TARGET" ] || { if [ "$SCOPE" = user ]; then TARGET="$HOME/.claude"; else TARGET="$(pwd)/.claude"; fi; }

have(){ command -v "$1" >/dev/null 2>&1; }
hasCurl=0; have curl && hasCurl=1
hasNode=0; have node && hasNode=1
PY=""; if have python3; then PY=python3; elif have python; then PY=python; fi

echo "Skill Federation installer"
echo "  source : $([ "$REMOTE_MODE" = 0 ] && echo "local clone ($SCRIPT_DIR)" || echo "remote ($RAW_BASE)")"
echo "  target : $TARGET (scope=$SCOPE)"
echo "  curl   : $([ $hasCurl = 1 ] && echo yes || echo 'NO - runtime needs curl!')"
echo "  node   : $([ $hasNode = 1 ] && echo yes || echo no)"
echo "  python : $([ -n "$PY" ] && echo yes || echo no)"
echo

# ALWAYS: curl tier (skill + command) - no JSON edits, works immediately.
# Each file is copied from the local clone or fetched from raw GitHub (no-clone bootstrap).
SKILL_DIR="$TARGET/skills/skill-federation"
mkdir -p "$SKILL_DIR" "$TARGET/commands"
resolve_source "integrations/claude-code/skills/skill-federation/SKILL.md" "$SKILL_DIR/SKILL.md"
resolve_source "integrations/claude-code/hooks/plan_nudge.json"            "$SKILL_DIR/plan_nudge.json"
resolve_source "integrations/claude-code/commands/skillfed.md"             "$TARGET/commands/skillfed.md"
echo "[curl] installed finder skill + /skillfed command (zero runtime)"
[ $hasCurl = 1 ] || echo "WARN: curl not found - install it or the finder cannot reach the federation."

# --with-hook: register the plan-approval nudge (safe merge + backup via python3)
if [ $WITH_HOOK = 1 ]; then
  CMD="curl -s \"file://$SKILL_DIR/plan_nudge.json\""
  SETT="$TARGET/settings.json"
  if [ -n "$PY" ]; then
    [ -f "$SETT" ] && cp "$SETT" "$SETT.bak" && echo "  backed up -> $SETT.bak"
    SKILLFED_CMD="$CMD" "$PY" - "$SETT" <<'PYEOF'
import json,os,sys
p=sys.argv[1]; cmd=os.environ["SKILLFED_CMD"]
d={}
if os.path.exists(p) and os.path.getsize(p)>0:
    with open(p,encoding="utf-8") as f: d=json.load(f)
ptu=d.setdefault("hooks",{}).setdefault("PostToolUse",[])
already=any(any("plan_nudge.json" in h.get("command","") for h in e.get("hooks",[])) for e in ptu)
if already:
    print("[hook] already registered; skipped")
else:
    ptu.append({"matcher":"ExitPlanMode","hooks":[{"type":"command","command":cmd,"timeout":20}]})
    with open(p,"w",encoding="utf-8") as f: json.dump(d,f,indent=2)
    print("[hook] registered plan-approval nudge in settings.json")
PYEOF
  else
    echo "[hook] no python found to safely edit JSON. Add this to $SETT (merge into hooks.PostToolUse):"
    echo "  {\"matcher\":\"ExitPlanMode\",\"hooks\":[{\"type\":\"command\",\"command\":\"$CMD\",\"timeout\":20}]}"
  fi
fi

# --with-npx: register the Node MCP server (project-scoped .mcp.json)
if [ $WITH_NPX = 1 ]; then
  if [ $hasNode != 1 ]; then
    echo "[npx] node not found - skipping MCP tier (curl tier is installed and works)."
  else
    MCP="$(pwd)/.mcp.json"
    # Clone mode -> local node server; remote/no-clone mode -> published `npx -y skillfed-mcp`.
    if [ "$REMOTE_MODE" = 0 ] && [ -f "$SCRIPT_DIR/mcp-server/index.mjs" ]; then
      SRV_CMD="node"; SRV_ARGS="[\"$SCRIPT_DIR/mcp-server/index.mjs\"]"; SRV_FORM="local-node form"
    else
      SRV_CMD="npx";  SRV_ARGS="[\"-y\",\"skillfed-mcp\"]";              SRV_FORM="npx -y skillfed-mcp"
    fi
    if [ -n "$PY" ]; then
      [ -f "$MCP" ] && cp "$MCP" "$MCP.bak" && echo "  backed up -> $MCP.bak"
      SKILLFED_CMD="$SRV_CMD" SKILLFED_ARGS="$SRV_ARGS" SKILLFED_EP="$ENDPOINT" SKILLFED_FORM="$SRV_FORM" "$PY" - "$MCP" <<'PYEOF'
import json,os,sys
p=sys.argv[1]; cmd=os.environ["SKILLFED_CMD"]; args=json.loads(os.environ["SKILLFED_ARGS"])
ep=os.environ["SKILLFED_EP"]; form=os.environ["SKILLFED_FORM"]
d={}
if os.path.exists(p) and os.path.getsize(p)>0:
    with open(p,encoding="utf-8") as f: d=json.load(f)
d.setdefault("mcpServers",{})["skillfed-mcp"]={"command":cmd,"args":args,"env":{"SKILLFED_ENDPOINT":ep}}
with open(p,"w",encoding="utf-8") as f: json.dump(d,f,indent=2)
print("[npx] registered Node MCP server ->",p,"("+form+")")
PYEOF
      if [ "$SRV_CMD" = node ]; then
        [ -d "$SCRIPT_DIR/mcp-server/node_modules" ] || echo "      run once: npm install --prefix \"$SCRIPT_DIR/mcp-server\""
      else
        echo "      note: uses the published skillfed-mcp on npm (npx fetches it on first run)."
      fi
    else
      echo "[npx] no python to edit .mcp.json. Add to $MCP:"
      echo "  {\"mcpServers\":{\"skillfed-mcp\":{\"command\":\"$SRV_CMD\",\"args\":$SRV_ARGS,\"env\":{\"SKILLFED_ENDPOINT\":\"$ENDPOINT\"}}}}"
    fi
  fi
fi

# --with-python: advanced/CI tier (print setup; no machine changes)
if [ $WITH_PYTHON = 1 ]; then
  echo "[python] advanced/CI tier - set these:"
  if [ "$REMOTE_MODE" = 0 ]; then
    echo "  export SKILLFED_HOME=\"$SCRIPT_DIR/integrations\""
    echo "  export SKILLFED_ENDPOINT=\"$ENDPOINT\""
    echo "  smoke test: python3 \"$SCRIPT_DIR/integrations/search_wishlist.py\" \"$SCRIPT_DIR/integrations/sample_wishlist.json\""
  else
    # No checkout: the advanced helpers live in the repo, or use the pip installer.
    echo "  the advanced Python helpers need the repo on disk - clone it, or:"
    echo "  uvx skillfed --with-python   (see python-installer/)"
    echo "  export SKILLFED_ENDPOINT=\"$ENDPOINT\""
  fi
fi

echo
echo "Done. Restart Claude Code, then run:  /skillfed <what you're trying to do>"
echo "Endpoint: $ENDPOINT (override with \$SKILLFED_ENDPOINT)"
