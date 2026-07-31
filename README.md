<div align="center">

# Skill Federation

### Free, private skill search for AI agents

<!-- Row 1 — Traction & proof (emphasized: for-the-badge) -->
[![Installs](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/skill-federation/skill-federation/badges/installs.json&label=installs&logo=serverless&logoColor=white&style=for-the-badge&cacheSeconds=300)](https://pypistats.org/packages/skillfed)
[![Clones](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/skill-federation/skill-federation/badges/clones.json&label=clones&logo=github&logoColor=white&style=for-the-badge&cacheSeconds=300)](https://github.com/skill-federation/skill-federation)
[![Stars](https://img.shields.io/github/stars/skill-federation/skill-federation?style=for-the-badge&color=E8C24A&logo=github&logoColor=white&cacheSeconds=1800)](https://github.com/skill-federation/skill-federation/stargazers)
[![SkillsBench](https://img.shields.io/badge/SkillsBench-%2B30%25%20vs%20bare%20agent-E07A55?style=for-the-badge)](#-benchmark)

<!-- Row 2 — Install & run (compact: flat-square) -->
[![npm](https://img.shields.io/npm/v/skillfed?logo=npm&logoColor=white&color=CB3837&label=npx%20skillfed&style=flat-square)](https://www.npmjs.com/package/skillfed)
[![PyPI](https://img.shields.io/pypi/v/skillfed?logo=pypi&logoColor=white&color=3775A9&label=uvx%20skillfed&style=flat-square)](https://pypi.org/project/skillfed/)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-8A8377?style=flat-square)
![Runtime](https://img.shields.io/badge/runtime-none%20(curl)-2E9E6B?style=flat-square)

<!-- Row 3 — Trust & terms (compact: flat-square) -->
[![License](https://img.shields.io/github/license/skill-federation/skill-federation?color=7C5CDB&style=flat-square)](LICENSE)
![Data sent](https://img.shields.io/badge/data%20sent-abstract%20wishes%20only-7C5CDB?style=flat-square)
[![Agent Skill](https://img.shields.io/badge/Agent%20Skill-spec--conformant-2E9E6B?style=flat-square)](https://agentskills.io)

<a href="https://skill-federation.github.io/"><img src="assets/demo.svg" alt="Running /skillfed to plan a launch for an open-source dev tool returns four vetted skill matches — multi-platform-launch, github-presence, community-building, product-analytics — to install" width="720"></a>

**Your agent asks. Skill Federation answers. You approve.**

*A bare agent solves 17.5% of SkillsBench tasks. With Skill Federation, 22.8% — and your work never leaves your machine.*

</div>

---

## Try a live search

See real matches before installing anything:

```bash
npx skillfed find "optimize a slow PostgreSQL query using EXPLAIN and indexes"
```

The command reads no files and installs nothing. It sends only the exact text inside the quotes,
so keep it capability-level and do not include code, secrets, customer data, or private task
context. Each result includes its source, license class, and provenance for review.

Your coding agent keeps rebuilding things that a packaged **skill** already does well — PDF
extraction, market sizing, data cleaning, PR review, Slack notifications, SQL reporting. The
skills exist, scattered across the open-source ecosystem. The problem is *finding the right one
mid-task* — and every "search a catalog" approach so far means shipping your plan, your brief,
or your data to someone's server.

**Skill Federation finds skills the privacy-preserving way.** Right after you approve a plan,
your agent writes an abstract **wish-list** — "if every skill existed, which would I reach for?"
— and the federation matches those wishes against a catalog of vetted skills. Your plan, your
files, and your outputs never leave your machine. Only the abstract wishes do.

> [!IMPORTANT]
> **Only the abstract wish crosses the boundary** — a one-line capability description, ~4
> vocabulary-varied paraphrases, 1–5 keywords, and a capability-level *sketch* of the ideal
> skill. Every field is "what skill should exist," never your task. Your plan, brief, file
> contents, and reasoning trace stay local — **always**.

**Here's the entire payload for one wish** — the literal string sent for `launch-strategy`.
It names the *capability domain*, never your task, plans, or product:

```text
description: plan a multi-channel launch for an open-source developer tool
paraphrases: orchestrate a launch across hacker news reddit and product hunt · plan a
             go-to-market launch for a dev tool · coordinate a multi-platform release
             announcement · design a launch-day plan for an open-source project
sketch:      launch product hunt hacker news waitlist go-to-market campaign ·
             channel planning timing asset prep announcement
keywords:    launch, gtm, product-hunt, strategy, announcement
```

That's it — a description, four paraphrases, a capability sketch, and keywords. Your product's
name, your unreleased roadmap, and your actual launch plan never appear.

<details>
<summary>Prefer plain text? Here's the same run</summary>

```
You: /skillfed plan a launch for my open-source dev tool

  -> agent writes 4 abstract wishes (paraphrases + a capability sketch).
     Only these leave your machine -- never your plan, files, or data.

  wish: launch-strategy       -> multi-platform-launch  review - verified             <- selected
  wish: repo-discoverability  -> github-presence        review - verified             <- selected
  wish: community-building    -> community-building     review - verified             <- selected
  wish: growth-analytics      -> product-analytics      permissive - verified - 221*  <- selected
       (each picked from 5 ranked candidates in the vetted catalog)

  Install the 4 selected? They go in .claude/skills/ with license + source attribution.
```

</details>

## 🔒 Why it's different

- **Privacy floor, by design.** Only the abstract wish crosses the boundary — "what skill should
  exist," never your task. Your plan, brief, file contents, and reasoning trace stay local,
  always. (Full field-by-field breakdown under **Privacy & trust** below.)
- **Trust before install.** Candidates come from a **pre-scanned internal registry**
  ([Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner) +
  [NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector)), not the wild repo — every one
  shows its license class, provenance, stars, and source. *You* approve each install; nothing is
  pulled silently. (See [Security](#-security).)
- **Native, zero-install.** The default tier needs nothing but `curl` — already on Windows 10+
  and macOS. No Python, no Node, no package manager. (Optional tiers add typed MCP tools if you
  have Node.)

## ⚙️ How it works

<div align="center">
  <img src="assets/howitworks.svg" alt="On your machine the agent approves a plan and writes abstract wishes; only the abstract wish crosses the boundary to the federation, which returns ranked candidates; you approve, the skill installs to .claude/skills/, and the agent uses it — your plan, files, and outputs never leave" width="760">
</div>

1. **Plan.** You approve a plan in your agent as usual.
2. **Wish-list.** The agent sketches the ideal skills and writes up to 10 abstract wishes — each
   with vocabulary-varied paraphrases and a structured capability sketch for high recall. No task
   specifics.
3. **Match.** The federation runs a fast lexical search per wish (description + paraphrases +
   flattened sketch) against the **vetted, pre-scanned catalog** and returns the top candidates.
4. **Review.** The agent picks the best fit (or rejects all) and shows you a trust table.
5. **Install.** On your approval, the chosen skills are fetched from the **internal scanned copy**
   (not the origin repo) into `.claude/skills/` with full license + source attribution.
6. **Use.** Your agent uses the skill immediately — no reinventing it.

## 📊 Benchmark

<div align="center">

<img src="assets/benchmark.svg" alt="SkillsBench task success: no skill 17.5%, Skill Federation 22.8%, oracle 36.8%" width="660">

</div>

We measured Skill Federation on **SkillsBench** (coding-agent tasks with deterministic verifiers),
with the agent harnessed as **Claude Code (Opus 4.6)**. The catch that makes this a real test:
the skill Skillfed retrieves comes from a **26,629-skill snapshot of the public catalog** (which
holds 87k+ skills overall) **with the benchmark's own answer skills removed** — so this measures
whether *independently authored* skills transfer to the task, not whether we can re-find the
benchmark's hand-written one.

| Condition | What the agent gets | Success |
|---|---|---|
| No skill | bare Claude Code (Opus 4.6) | 17.5% |
| **Skillfed** | top skill retrieved from the 26,629-skill snapshot | **22.8%** |
| Oracle | the task's own hand-written skill — an unreachable upper bound | 36.8% |

Skillfed lifts success **from 17.5% to 22.8% — a ~30% relative gain** over the bare agent, and
recovers **~27% of the gap** to an oracle skill it never sees. Most skill-retrieval results test
*oracle-recovery* (the benchmark's own skill sits in the pool); this tests *transfer* — useful
skills pulled from a large, noisy public catalog.

## 📦 Install

**Codex, Cursor, Gemini CLI, Copilot, OpenCode, Claude Code, and more:**

```bash
npx skills add skill-federation/skill-federation --skill skill-federation
```

The open [`skills`](https://github.com/vercel-labs/skills) installer detects compatible agents
and lets you choose the destination. Its default is project scope; add `--global` for your user
profile or target one explicitly:

```bash
npx skills add skill-federation/skill-federation --skill skill-federation --agent codex --global
```

This installs the portable Agent Skill. It does not add Claude Code's `/skillfed` command or
plan-approval hook.

**Enhanced Claude Code integration — one line, no clone needed:**

```bash
# Node — npm
npx skillfed
```
```bash
# Python — uv   (or:  pipx run skillfed)
uvx skillfed
```

**Prefer Claude Code's plugin system?** Add the marketplace and install the plugin:

```text
/plugin marketplace add skill-federation/skill-federation
/plugin install skill-federation@skill-federation
```

**No Node or Python?** Ask Claude Code to install the curl version for you:

```text
Install the Skill Federation /skillfed finder from github.com/skill-federation/skill-federation
— run its curl installer (install.ps1 on Windows, install.sh on macOS/Linux), then tell me to
restart Claude Code.
```

> [!TIP]
> Then **restart Claude Code** and run `/skillfed <what you're trying to do>` — or just approve
> a plan and the finder offers itself automatically.

Zero runtime — the finder needs only `curl` (no Node or Python). For the optional tiers
(auto-trigger hook · typed MCP tools · Python/CI helper), flags, scopes, installing from a
checkout, and config-safety details, see [`install.md`](install.md).

<details>
<summary>Prefer to paste it yourself? (raw curl one-liner)</summary>

```powershell
# Windows (PowerShell) — irm|iex also sidesteps the execution-policy block
irm https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.ps1 | iex
```
```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/skill-federation/skill-federation/main/install.sh | bash
```

</details>

## 🛡️ Privacy & trust

> [!NOTE]
> **What never crosses:** your plan, brief, file contents, outputs, or reasoning trace.
> **What does:** only the abstract wish (description + paraphrases + keywords + capability sketch).

<details>
<summary>The full field-by-field breakdown</summary>

- **What crosses the boundary:** the abstract wish — its one-line `description`, ~4 paraphrased
  `formulations` of it, 1–5 `keywords`, and a structured **capability `sketch`** of the ideal skill
  (`purpose / inputs / outputs / operations / domain_vocab / section_sketch / tags`). The sketch's
  flattened terms ride inside the search query on every search (they supply the discriminative
  vocabulary that drives recall); when no skill is found, that same sketch becomes the demand
  pointer — abstract enough to protect you, detailed enough to auto-build the missing skill. Every
  field is "what skill should exist", never your task. The wish's `name` is display-only and is not
  sent.
- **What never crosses:** your plan, brief, file contents, outputs, or reasoning trace.
- **Two complementary signals, not conflated:** a `report_selection` labels retrieval quality
  (which shown candidates were right or wrong); a `report_demand` captures the capability gap (what
  was actually needed). They feed different loops — selection sharpens search, demand drives what
  gets built next.
- **Local-first:** if you already have a skill installed, your local copy is used as-is — your
  edits are personalization, never silently overwritten.

</details>

## 🔒 Security

Skill Federation treats every third-party skill as untrusted input. **Skills are served from our
internal, pre-scanned registry — never pulled live from the wild repo.** At ingestion we copy each
candidate, dedupe it, and scan it; only passing skills are promoted and served. The `source` link
you see is provenance, not where the skill is fetched from.

Every candidate is best-effort scanned with two independent tools:

- **[Cisco AI Defense Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner)** —
  YARA/pattern, bytecode, command-taint, behavioral dataflow, LLM-as-judge, and VirusTotal checks
  for prompt injection, data exfiltration, and malicious code.
- **[NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector)** — vulnerability-pattern + LLM
  analysis with live OSV.dev CVE lookups and a 0–100 risk score.

High/critical findings are **rejected or routed to manual review before promotion** — the wild
catalog never reaches you unfiltered.

**Why this matters.** NVIDIA's study behind SkillSpector scanned **42,447 public skills** and found
**26.1% carried at least one vulnerability** and **5.2% showed likely malicious intent** — and an
installed skill runs with your agent's full permissions. Serving straight from public repos would
hand roughly one-in-four vulnerable and one-in-twenty malicious skills to your agent; the ingest
gate is what keeps them out.

> [!NOTE]
> Scanning is **best-effort**, not a guarantee. As Cisco's scanner puts it, *"no findings ≠ no
> risk"* — a clean scan is not proof a skill is safe. Skill Federation still shows each skill's
> license, provenance, and source, and **nothing installs without your approval**.

## 🔧 Configuration

The finder talks to a federation endpoint over HTTPS. Default is a keyless demo; override it:

```bash
export SKILLFED_ENDPOINT="https://your-federation.example.com"   # or set in .mcp.json for the npx tier
```

## 📁 What's in this repo

```
install.ps1 / install.sh / install.md   auto-detecting installer; works from a clone OR piped (irm|iex, curl|bash)
installer/                              npm package `skillfed` — the `npx skillfed` no-clone path
python-installer/                       PyPI package `skillfed` — the `uvx skillfed` / `pipx run skillfed` path
scripts/vendor-payload.mjs              vendors the 3 payload files into both packages (single source of truth)
integrations/claude-code/               the Claude Code plugin (skill + /skillfed + hook) — canonical payload
integrations/*.py                       optional Python tier (advanced / CI)
mcp-server/                             optional Node MCP tier (typed tools via npx skillfed-mcp)
```

## 📄 License

[MIT](LICENSE) © Skill Federation.
