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
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.ps1))) -WithHook -Scope project
```
```bash
# bash: forward args after `-s --`
curl -fsSL https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.sh | bash -s -- --with-hook --scope project
```
```bash
npx skillfed --with-hook --scope project
uvx skillfed --with-hook --scope project
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

Then **restart Claude Code** and run `/skillfed <what you're trying to do>`.

## What it installs

| Tier | Needs | Installed by | Gets you |
|---|---|---|---|
| **curl** (default, always) | nothing — `curl` ships with Win10+/macOS | every run | the finder skill + `/skillfed` command, runtime-free |
| **hook** | nothing | `--with-hook` / `-WithHook` | auto-nudge to run the finder right after a plan is approved |
| **npx** (Node MCP) | Node ≥18 | `--with-npx` / `-WithNpx` | Claude calls typed `find_skills`/… tools instead of shelling out |
| **python** | a Python interpreter | `--with-python` / `-WithPython` | prints the advanced/CI env-var setup |

The installer prints what it detected (`curl` / `node` / `python`) and installs the **curl tier
unconditionally** — it's the only one that needs no runtime and works on the standalone Claude
Code desktop build *and* the npm CLI. The other tiers are opt-in flags.

## Options

```
-Scope  user|project   (PS)   |   --scope user|project   (sh)    # ~/.claude (default) vs ./.claude
-Endpoint <url>        (PS)   |   --endpoint <url>        (sh)    # default: qurini keyless demo
-RawBase <url>         (PS)   |   --raw-base <url>        (sh)    # no-clone fetch source (default: raw GitHub main)
-WithHook / -WithNpx / -WithPython     |     --with-hook / --with-npx / --with-python
```

Examples:
```powershell
.\install.ps1 -WithHook                       # curl + auto-trigger
.\install.ps1 -WithNpx                         # curl + Node MCP tools (if node present)
.\install.ps1 -Scope project -Endpoint https://my-federation.example.com
```

## What it writes (and safety)

- `~/.claude/skills/skill-federation/SKILL.md` + `plan_nudge.json`, and
  `~/.claude/commands/skillfed.md` — plain file copies, no config surgery.
- `--with-hook`: merges one entry into `~/.claude/settings.json` (or project) — **backs up to
  `settings.json.bak` first**, preserves your existing keys/hooks, and is idempotent.
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
  --data-binary '{"tenant":"local","wish":"extract tables from PDF documents","keywords":["pdf","table-extraction","parsing"],"top_n":3}'
```
A JSON payload with ranked `candidates` means you're wired up. Then just use `/skillfed`.
