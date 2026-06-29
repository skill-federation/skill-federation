<div align="center">

# Skill Federation

### The trusted skill layer for AI agents.

**Find vetted agent skills for the task in front of you — without sending your work to anyone.**

</div>

---

Your coding agent keeps rebuilding things that a packaged **skill** already does well — PDF
extraction, market sizing, data cleaning, PR review, Slack notifications, SQL reporting. The
skills exist, scattered across the open-source ecosystem. The problem is *finding the right one
mid-task* — and every "search a catalog" approach so far means shipping your plan, your brief,
or your data to someone's server.

**Skill Federation finds skills the privacy-preserving way.** Right after you approve a plan,
your agent writes an abstract **wish-list** — "if every skill existed, which would I reach for?"
— and the federation matches those wishes against a catalog of vetted skills. Your plan, your
files, and your outputs never leave your machine. Only the abstract wishes do.

```
You: /skillfed automate monthly vendor-invoice reconciliation

  wish: pdf-data-extraction   -> pdf-processing        [MIT - verified]
  wish: data-cleaning         -> data-cleaning         [MIT - verified]
  wish: chat-notification     -> slack                 [MIT - verified, 235*]
  ...

  Install these 3? They'll go in .claude/skills/ with license + source attribution.
```

## Why it's different

- **Privacy floor, by design.** Only the abstract wish crosses the boundary — a one-line
  capability description, a few vocabulary-varied paraphrases of it, and 1–5 keywords. Your plan,
  brief, file contents, and reasoning trace stay local — always.
- **Trust before install.** Every candidate shows its license class, provenance, stars, source,
  and any security flags. *You* approve each install. Nothing is pulled silently.
- **Native, zero-install.** The default tier needs nothing but `curl` — already on Windows 10+
  and macOS. No Python, no Node, no package manager. (Optional tiers add typed MCP tools if you
  have Node.)

## How it works

1. **Plan.** You approve a plan in your agent as usual.
2. **Wish-list.** The agent privately sketches the ideal skills and writes up to 10 abstract
   wishes — each with vocabulary-varied paraphrases for high recall. No task specifics.
3. **Match.** The federation runs a fast lexical search per wish and returns the top candidates.
4. **Review.** The agent picks the best fit (or rejects all) and shows you a trust table.
5. **Install.** On your approval, the chosen skills are fetched into `.claude/skills/` with
   full license + source attribution.
6. **Use.** Your agent uses the skill immediately — no reinventing it.

## Install

From this repo's root:

```powershell
# Windows (PowerShell)
.\install.ps1
```
```bash
# macOS / Linux
chmod +x install.sh && ./install.sh
```

Then **restart Claude Code** and run `/skillfed <what you're trying to do>` — or just approve a
plan and the finder offers itself automatically.

The installer auto-detects your machine and always installs the **curl** tier (zero runtime).
Opt into more with flags:

| Tier | Needs | Enable | Gets you |
|---|---|---|---|
| **curl** (default) | nothing (`curl` ships with Win10+/macOS) | *always* | the finder skill + `/skillfed`, runtime-free |
| **hook** | nothing | `--with-hook` / `-WithHook` | auto-nudge right after a plan is approved |
| **npx** (Node MCP) | Node >= 18 | `--with-npx` / `-WithNpx` | Claude calls typed `find_skills` tools, no shell-out |
| **python** | a Python interpreter | `--with-python` / `-WithPython` | the advanced / CI helper path |

See [`install.md`](install.md) for options, scopes, and safety details (it backs up and merges
config, never clobbers).

## Privacy & trust

- **What crosses the boundary:** the abstract wish — its one-line `description`, ~4 paraphrased
  `formulations` of it (for search recall), and 1–5 `keywords`; and, only when nothing matches, an
  abstract capability *sketch* of the missing skill. The wish's `name` is display-only and is not sent.
- **What never crosses:** your plan, brief, file contents, outputs, or reasoning trace.
- **Demand vs. rejection are never conflated:** an empty result records a catalog gap; rejecting
  shown candidates records a retrieval-quality signal. Different streams, by design.
- **Local-first:** if you already have a skill installed, your local copy is used as-is — your
  edits are personalization, never silently overwritten.

## Configuration

The finder talks to a federation endpoint over HTTPS. Default is a keyless demo; override it:

```bash
export SKILLFED_ENDPOINT="https://your-federation.example.com"   # or set in .mcp.json for the npx tier
```

## What's in this repo

```
install.ps1 / install.sh / install.md   one-command, auto-detecting installer
integrations/claude-code/               the Claude Code plugin (skill + /skillfed + hook)
integrations/*.py                       optional Python tier (advanced / CI)
mcp-server/                             optional Node MCP tier (typed tools via npx)
```

## License

[MIT](LICENSE) © Skill Federation.
