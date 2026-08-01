# Install Skill Federation

One command. It auto-detects what's on your machine and installs the right tier — you don't
choose wrong.

## No-clone one-liners (recommended)

```powershell
# Windows (PowerShell) — irm|iex also sidesteps the script-execution-policy block
irm https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.ps1 | iex
```
```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.sh | bash
```
```bash
# Node ≥18 present?  versioned, auto-updating, npm-signed:
npx skillfed
# uv / pipx present?  same, for Python shops & CI:
uvx skillfed            # or:  pipx run skillfed
```

**Passing flags through a pipe** (a bare `irm|iex` / `curl|bash` can't take args):

```powershell
# PowerShell: turn the fetched text into a scriptblock you can pass params to
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.ps1))) -Hook end -Scope project
```
```bash
# bash: forward args after `-s --`
curl -fsSL https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.sh | bash -s -- --hook end --scope project
```
```bash
npx skillfed --hook end --scope project
uvx skillfed --hook end --scope project
```

> [!NOTE]
> **Piping a remote script runs it sight-unseen.** The bootstrap fetches over HTTPS from this
> repo's `main`, and needs only `curl`. Cautious? Read it first — `irm <url>` (PowerShell) or
> `curl <url>` (shell) prints the script; review, then pipe. `npx`/`uvx` instead pin a
> registry-published, versioned package.

## From a checkout

```powershell
# Windows (PowerShell), from the repo root:
.\install.ps1
```
```bash
# macOS / Linux, from the repo root:
chmod +x install.sh && ./install.sh
```

The same scripts power the one-liners above: from a clone they copy the payload locally; piped
from the network they fetch it from raw GitHub (override the source with `-RawBase` / `--raw-base`).

Then **restart Claude Code** and run `/skillfed <what you're trying to do>` — or just work
normally and let the skill offer itself.

## What it installs

| Tier | Needs | Installed by | Gets you |
|---|---|---|---|
| **curl** (default, always) | nothing — `curl` ships with Win10+/macOS | every run | the finder skill + `/skillfed` command, runtime-free |
| **hooks** (optional) | nothing | `--hook start\|end\|both` / `-Hook` | 0–2 planning nudges — `start` on prompts submitted while in plan mode, `end` after a plan is approved |
| **npx** (Node MCP) | Node ≥18 | `--with-npx` / `-WithNpx` | Claude calls typed `find_skills`/… tools instead of shelling out |
| **python** | a Python interpreter | `--with-python` / `-WithPython` | prints the advanced/CI env-var setup |

The installer prints what it detected (`curl` / `node` / `python`) and installs the **curl tier
unconditionally** — it's the only one that needs no runtime and works on the standalone Claude
Code desktop build *and* the npm CLI. The other tiers are opt-in flags.

**Hooks are optional, and `none` is the default.** The finder skill carries its own triggers in
its own body — it offers itself when you start a plan, finish one, or hit a capability gap
mid-task — so a hook only *repeats* a trigger the skill already has. That is also why the skill
works in any harness, or with no harness at all. Both nudge files and the gate script are copied
on **every** install whatever the mode, so switching `--hook` later is a `settings.json` edit,
never a re-fetch.

## Options

```
-Harness <name>        (PS)   |   --harness <name>        (sh)    # default & only value today: claude-code
-Hook none|start|end|both (PS)|   --hook none|start|end|both (sh) # register 0-2 nudges (default: none)
-WithHook              (PS)   |   --with-hook             (sh)    # legacy alias for -Hook end
-Scope  user|project   (PS)   |   --scope user|project    (sh)    # ~/.claude (default) vs ./.claude
-Endpoint <url>        (PS)   |   --endpoint <url>        (sh)    # default: qurini keyless demo
-RawBase <url>         (PS)   |   --raw-base <url>        (sh)    # no-clone fetch source (default: raw GitHub main)
-WithNpx / -WithPython        |   --with-npx / --with-python
```

`--harness` names the harness to install into; `claude-code` is the default and, today, the only
accepted value — anything else exits `2` listing what is supported. `--hook` is only valid for a
harness that has a hook mechanism at all, and is rejected with a clear message otherwise.
Resolution order is: an explicit `--hook` wins, then the legacy `--with-hook` switch, then `none`.
The installer prints the resolved harness and hook mode before it writes anything.

Examples:
```powershell
.\install.ps1                                  # curl tier, no hooks — a complete install
.\install.ps1 -Hook end                        # + the end-of-plan nudge
.\install.ps1 -Hook both                       # + the start-of-plan nudge as well
.\install.ps1 -WithNpx                         # curl + Node MCP tools (if node present)
.\install.ps1 -Scope project -Endpoint https://my-federation.example.com
```

## What it writes (and safety)

- `~/.claude/skills/skill-federation/` — `SKILL.md`, `demand-sketch.md`, and the three hook
  assets (`plan_nudge.json`, `plan_start_nudge.json`, `start_nudge.sh`) — plus
  `~/.claude/commands/skillfed.md`. Plain file copies, no config surgery. **All six land on every
  run**, whatever `--hook` says; the nudge files are inert until one is registered.
- `--hook`: merges **0–2** entries into `~/.claude/settings.json` (or project) — `end` adds a
  `PostToolUse`/`ExitPlanMode` entry, `start` adds a `UserPromptSubmit` entry that self-gates on
  plan mode via `start_nudge.sh`. It **backs up to `settings.json.bak` once** before the first
  write, preserves your existing keys/hooks, and each entry is idempotency-checked against its own
  filename, so re-running never double-registers.
- `--with-npx`: writes/merges `./.mcp.json` (project-scoped) — also backed up. Requires Node. The
  form depends on how you ran the installer: **from a clone** it registers the local
  `mcp-server/` (run `npm install` in it once); **no-clone / piped** (and the `npx skillfed`
  installer) it registers the published `npx -y skillfed-mcp` form, since there's no local server
  on disk.

JSON edits use a safe serializer (PowerShell) or `python3` (shell, with a printed paste-in
fallback if absent). The **runtime** path only ever needs `curl`.

## Verify

```bash
# the finder's search call, by hand (curl.exe on Windows):
curl -s -X POST "https://qurini-skill-federation.hf.space/search" \
  -H "Content-Type: application/json" \
  --data-binary '{"tenant":"local","wish":"extract tables from PDF documents","keywords":["pdf","table-extraction","parsing"],"top_n":10}'
```
A JSON payload with ranked `candidates` means you're wired up. Then just use `/skillfed`.
