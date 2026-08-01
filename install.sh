#!/usr/bin/env bash
# Skill Federation - installer (macOS / Linux)
#
# Auto-detects what's on the machine and installs the right tier:
#   ALWAYS        : the curl-based finder (skill + /skillfed command) - zero runtime, just curl.
#   --hook MODE   : register 0-2 nudge hooks in settings.json (safe merge + backup). Default none.
#   --with-npx    : also register the Node MCP server (requires node) for typed-tool ergonomics.
#   --with-python : print the advanced/CI Python-helper setup.
#
# Hooks are a per-harness convenience and nothing more - they only repeat triggers the skill
# already carries in its own body. The default is --hook none: the skill is complete, and
# portable to any harness (or none at all), with no hook registered. Both nudge files and the
# gate script are installed whatever the mode, so switching --hook later needs no re-fetch.
#
# JSON edits (hook / npx) use python3 if present - with a printed paste-in fallback if not.
# The RUNTIME path needs only curl; python here is an install-time convenience.
#
# Examples:
#   ./install.sh                 # curl tier, user scope (~/.claude), no hooks
#   ./install.sh --hook end      # + the end-of-plan nudge
#   ./install.sh --hook both     # + the start-of-plan nudge as well
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

SCOPE=user; TARGET=""; HARNESS=claude-code; HOOK=""; WITH_HOOK=0; WITH_NPX=0; WITH_PYTHON=0
ENDPOINT="https://qurini-skill-federation.hf.space"
usage() {
  cat <<'USAGE'
Usage: ./install.sh [options]

  --scope user|project           where to install (default: user -> ~/.claude)
  --target <dir>                 install into an explicit directory instead
  --harness <name>               target harness (default: claude-code; supported: claude-code)
  --hook none|start|end|both     register 0-2 nudge hooks (default: none)
  --with-hook                    legacy alias for --hook end
  --with-npx                     also register the Node MCP server (needs node)
  --with-python                  print the advanced/CI Python-helper setup
  --endpoint <url>               federation endpoint to record
  --raw-base <url>               raw GitHub base for no-clone fetches
  -h, --help

Hooks are a per-harness convenience, not part of the product. They only repeat triggers the
skill already carries in its own body, so the skill works identically with no hook, in any
harness, and with no harness at all. Both nudge files are copied either way, so switching
--hook later never needs a re-fetch.
USAGE
}
while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE="$2"; shift 2;;
    --target) TARGET="$2"; shift 2;;
    --harness) HARNESS="$2"; shift 2;;
    --hook) HOOK="$2"; shift 2;;
    --with-hook) WITH_HOOK=1; shift;;
    --with-npx) WITH_NPX=1; shift;;
    --with-python) WITH_PYTHON=1; shift;;
    --endpoint) ENDPOINT="$2"; shift 2;;
    --raw-base) RAW_BASE="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "unknown arg: $1"; exit 2;;
  esac
done

# Harness gate. HARNESS_HOOKS says whether this harness has a hook mechanism at all;
# --hook is rejected below for any harness where it is 0.
case "$HARNESS" in
  claude-code) HARNESS_HOOKS=1;;
  *) echo "error: unknown --harness '$HARNESS'; supported: claude-code" >&2; exit 2;;
esac
# Resolution order: explicit --hook wins, then the legacy --with-hook switch, then none.
if [ -n "$HOOK" ]; then
  case "$HOOK" in
    none|start|end|both) ;;
    *) echo "error: --hook must be none|start|end|both (got '$HOOK')" >&2; exit 2;;
  esac
elif [ "$WITH_HOOK" = 1 ]; then HOOK=end
else HOOK=none
fi
if [ "$HOOK" != none ] && [ "$HARNESS_HOOKS" = 0 ]; then
  echo "error: harness '$HARNESS' has no hook support - drop --hook/--with-hook. The skill is complete without hooks." >&2
  exit 2
fi

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
echo "  harness: $HARNESS (hooks: $HOOK)"
echo "  curl   : $([ $hasCurl = 1 ] && echo yes || echo 'NO - runtime needs curl!')"
echo "  node   : $([ $hasNode = 1 ] && echo yes || echo no)"
echo "  python : $([ -n "$PY" ] && echo yes || echo no)"
echo

# ALWAYS: curl tier (skill + command) - no JSON edits, works immediately.
# Each file is copied from the local clone or fetched from raw GitHub (no-clone bootstrap).
# Both nudges and the gate script ship regardless of $HOOK so switching modes needs no re-fetch.
SKILL_DIR="$TARGET/skills/skill-federation"
mkdir -p "$SKILL_DIR" "$TARGET/commands"
resolve_source "integrations/claude-code/skills/skill-federation/SKILL.md"          "$SKILL_DIR/SKILL.md"
resolve_source "integrations/claude-code/skills/skill-federation/demand-sketch.md"  "$SKILL_DIR/demand-sketch.md"
resolve_source "integrations/claude-code/hooks/plan_nudge.json"                     "$SKILL_DIR/plan_nudge.json"
resolve_source "integrations/claude-code/hooks/plan_start_nudge.json"               "$SKILL_DIR/plan_start_nudge.json"
resolve_source "integrations/claude-code/hooks/start_nudge.sh"                      "$SKILL_DIR/start_nudge.sh"
resolve_source "integrations/claude-code/commands/skillfed.md"                      "$TARGET/commands/skillfed.md"
chmod +x "$SKILL_DIR/start_nudge.sh" 2>/dev/null || true
echo "[curl] installed finder skill + /skillfed command (zero runtime)"
[ $hasCurl = 1 ] || echo "WARN: curl not found - install it or the finder cannot reach the federation."

# --hook: register 0-2 nudge entries (safe merge + a single backup, idempotent, via python3)
if [ "$HOOK" != none ]; then
  SETT="$TARGET/settings.json"
  # Shell form (what actually gets stored) and JSON-escaped form (for the no-python fallback).
  END_CMD="curl -s \"file://$SKILL_DIR/plan_nudge.json\""
  START_CMD="sh \"$SKILL_DIR/start_nudge.sh\""
  END_CMD_JSON='curl -s \"file://'"$SKILL_DIR"'/plan_nudge.json\"'
  START_CMD_JSON='sh \"'"$SKILL_DIR"'/start_nudge.sh\"'

  # register_entry <event> <matcher|""> <needle> <command> <timeout> <label>
  #
  # One settings.json entry, merged in place. The event and matcher are parameters rather than
  # hardcoded, so this heredoc is written once and reused for both nudges. An EMPTY matcher
  # omits the "matcher" key entirely (UserPromptSubmit has no tool name to match on).
  #
  # <needle> is the idempotency probe, and each one is a substring of ITS OWN command only:
  # the start command names start_nudge.sh, the end command names plan_nudge.json, and neither
  # string occurs in the other. (Note that "plan_start_nudge.json" does NOT contain
  # "plan_nudge.json" either - re-verify by hand if any of these files is ever renamed.)
  #
  # The BACKUP lives inside this function, not before the loop, because only the merge knows
  # whether it is about to write: an unconditional `cp` clobbers the pristine .bak on any
  # re-run where everything is already registered (--hook start, then end, then both would
  # leave .bak holding the ALREADY-HOOKED file). $BACKED_UP carries "one per invocation"
  # across calls - python cannot set it, so it prints the line and the shell reads it back.
  BACKED_UP=0
  register_entry() {
    out="$(SKILLFED_EVENT="$1" SKILLFED_MATCHER="$2" SKILLFED_NEEDLE="$3" SKILLFED_CMD="$4" \
    SKILLFED_TIMEOUT="$5" SKILLFED_LABEL="$6" SKILLFED_BACKED_UP="$BACKED_UP" "$PY" - "$SETT" <<'PYEOF'
import json,os,shutil,sys
p=sys.argv[1]
event=os.environ["SKILLFED_EVENT"]; matcher=os.environ.get("SKILLFED_MATCHER","")
needle=os.environ["SKILLFED_NEEDLE"]; cmd=os.environ["SKILLFED_CMD"]
timeout=int(os.environ.get("SKILLFED_TIMEOUT") or 20)
label=os.environ.get("SKILLFED_LABEL") or event
backed=os.environ.get("SKILLFED_BACKED_UP")=="1"
d={}
if os.path.exists(p) and os.path.getsize(p)>0:
    with open(p,encoding="utf-8") as f: d=json.load(f)
arr=d.setdefault("hooks",{}).setdefault(event,[])
already=any(any(needle in str(h.get("command","")) for h in e.get("hooks",[])) for e in arr)
if already:
    print("[hook] %s already registered; skipped" % label)
else:
    # first real write of this run -> take the one backup (of the file as the user had it)
    if not backed and os.path.exists(p):
        shutil.copyfile(p,p+".bak")
        print("  backed up -> %s.bak" % p)
    entry={}
    if matcher: entry["matcher"]=matcher
    entry["hooks"]=[{"type":"command","command":cmd,"timeout":timeout}]
    arr.append(entry)
    with open(p,"w",encoding="utf-8") as f: json.dump(d,f,indent=2)
    print("[hook] registered %s (%s) in settings.json" % (label,event))
PYEOF
)"
    printf '%s\n' "$out"
    case "$out" in *"backed up ->"*) BACKED_UP=1;; esac
  }

  if [ -n "$PY" ]; then
    case "$HOOK" in
      start|both) register_entry UserPromptSubmit "" start_nudge.sh "$START_CMD" 10 "start-of-plan nudge";;
    esac
    case "$HOOK" in
      end|both) register_entry PostToolUse ExitPlanMode plan_nudge.json "$END_CMD" 20 "end-of-plan nudge";;
    esac
  else
    echo "[hook] no python found to safely edit JSON. Add these to $SETT:"
    case "$HOOK" in
      start|both) echo "  hooks.UserPromptSubmit += {\"hooks\":[{\"type\":\"command\",\"command\":\"$START_CMD_JSON\",\"timeout\":10}]}";;
    esac
    case "$HOOK" in
      end|both) echo "  hooks.PostToolUse      += {\"matcher\":\"ExitPlanMode\",\"hooks\":[{\"type\":\"command\",\"command\":\"$END_CMD_JSON\",\"timeout\":20}]}";;
    esac
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
    # No checkout: the advanced helpers only exist in the repo. Do NOT point at
    # `uvx skillfed --with-python` - that flag is curl-installer-only, so argparse exits 2.
    echo "  the advanced Python helpers need the repo on disk:"
    echo "  git clone https://github.com/skill-federation/skill-federation   (see integrations/)"
    echo "  export SKILLFED_ENDPOINT=\"$ENDPOINT\""
  fi
fi

echo
echo "Done. Restart Claude Code, then run:  /skillfed <what you're trying to do>"
echo "Endpoint: $ENDPOINT (override with \$SKILLFED_ENDPOINT)"
