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

<a href="https://skill-federation.github.io/"><img src="assets/demo.svg" alt="Running /skillfed to plan a launch for an open-source dev tool returns four vetted skill matches — multi-platform-launch, github-presence, community-building, product-analytics — all four read in context as field notes, with only the one you'll reuse installed" width="720"></a>

**Your agent asks. Skill Federation answers. You approve.**

*A bare agent solves 17.5% of SkillsBench tasks. With Skill Federation, 22.8% — and your work never leaves your machine.*

**Browse and search the indexed skill catalog on the web → [skillfed.io](https://skillfed.io)**

</div>

---

Your coding agent keeps rebuilding things that a packaged **skill** already does well — PDF
extraction, market sizing, data cleaning, PR review, Slack notifications, SQL reporting. The
skills exist, scattered across the open-source ecosystem. The problem is *finding the right one
mid-task* — and every "search a catalog" approach so far means shipping your plan, your brief,
or your data to someone's server.

**Skill Federation finds skills the privacy-preserving way.** Whenever current practice is
load-bearing — as your agent starts planning, before it executes, or the moment it hits a gap
mid-task — it writes an abstract **wish-list** ("if every skill existed, which would I reach
for?") and the federation matches those wishes against a catalog of vetted skills. Your plan,
your files, and your outputs never leave your machine. Only the abstract wishes do.

**Skills are field notes, not rules.** A model's weights are an average of what was written
before its training cutoff; a maintained skill is a dated artifact that carries the difference.
So the default is to pull **several** and *read* them — take the criteria and gotchas that bear
on the task, cross-check where they disagree — and to install only the rare one you'll reuse,
with your approval. In our own testing, skills read against work a capable model had already
optimised still surfaced real defects it had missed — and some of the skills' own advice was
itself out of date. Both point the same way: read several, trust none absolutely. (The catalog
and our ongoing research notes are at [skillfed.io](https://skillfed.io).)

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

  wish: launch-strategy       -> multi-platform-launch  review - verified             <- read
  wish: repo-discoverability  -> github-presence        review - verified             <- read
  wish: community-building    -> community-building     review - verified             <- read
  wish: growth-analytics      -> product-analytics      permissive - verified - 221*  <- read
       (each picked from 10 ranked candidates in the vetted catalog)

  Read all 4 in context -- nothing hits disk. Install only the 1 you'll reuse?
  It goes in .claude/skills/ with license + source attribution.
```

</details>

## 🔒 Why it's different

- **Privacy floor, by design.** Only the abstract wish crosses the boundary — "what skill should
  exist," never your task. Your plan, brief, file contents, and reasoning trace stay local,
  always. (Full field-by-field breakdown under **Privacy & trust** below.)
- **Trust before you read — and again before you install.** Candidates come from a **pre-scanned
  internal registry** ([Cisco Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner) +
  [NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector)), not the wild repo — every one
  shows its license class, provenance, stars, and source. That matters twice over: a *consulted*
  body is untrusted third-party text entering your agent's context, and unlike an installed skill
  it leaves no `SOURCE.txt` behind — so the agent has to name what it read and where it came from
  in its reply. *You* approve each install; nothing is written to disk silently.
  (See [Security](#-security).)
- **Native, zero-install.** The default tier needs nothing but `curl` — already on Windows 10+
  and macOS. No Python, no Node, no package manager. (Optional tiers add typed MCP tools if you
  have Node.)

## ⚙️ How it works

<div align="center">
  <img src="assets/howitworks.svg" alt="On your machine the agent writes abstract wishes as a plan starts or is approved; only the abstract wish crosses the boundary to the federation, which returns ranked candidates; you see a trust review, the agent reads the notes in context, and installs to .claude/skills/ only what you'll reuse — your plan, files, and outputs never leave" width="760">
</div>

1. **Ask** — at any of three moments: as the agent *starts* planning (so skills shape the
   approach), when it *finishes* a plan, or mid-task the instant it hits a capability it was
   about to build from scratch. Or just run `/skillfed <what you're doing>`. It's a search, not
   a ritual — once or several times per task.
2. **Wish-list.** The agent sketches the ideal skills and writes up to 10 abstract wishes — each
   with vocabulary-varied paraphrases and a structured capability sketch for high recall. No task
   specifics.
3. **Match.** The federation runs a fast lexical search per wish (description + paraphrases +
   flattened sketch) against the **vetted, pre-scanned catalog** and returns the top candidates
   (10 per wish by default, 1–25 on request).
4. **Read — the default.** The agent pulls **several** promising candidates per wish, reads them
   in context as field notes, and cross-checks where they disagree. Nothing is written to disk.
   You get a trust table (license · provenance · stars · source) plus a plain statement of which
   skills it read and what it took from each. **For most tasks it ends here.**
5. **Install — the exception.** Only when a skill is genuinely good *and* you expect to reuse it,
   and only on your explicit approval: it's fetched from the **internal scanned copy** (not the
   origin repo) into `.claude/skills/` with full license + source attribution. Nothing you only
   needed to read once gets installed.

## 🌍 Works anywhere

**No harness required — not even Claude Code.** The finder skill carries its own triggers and its
own instructions, so it works with no hook registered, in any harness that can load a skill body,
and with no harness at all: paste it into a plain chat and it still knows when to search, what a
skill is for, and how to read one. The optional hooks below are a Claude Code convenience that
only *repeats* triggers the skill already has — which is why `--hook none` is the default.

**Nothing installed, just a browser?** Ask any chat to *use skillfed.io to find a skill* — or
paste in [the skill body itself](integrations/claude-code/skills/skill-federation/SKILL.md),
which carries the whole procedure. The zero-install loop is two GETs: **find** a skill by web
search, or from the `/best/{term}` and publisher hubs on [skillfed.io](https://skillfed.io); then
**read** it by appending `.md` to any skill page URL for the full body. One caveat, stated
plainly: the wish-list search is POST-only
today, so a browsing-only chat can *read* skills but cannot run the federated wish query.

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

**One line — no clone needed.** You've already got Node or Python:

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
> Then **restart Claude Code** and run `/skillfed <what you're trying to do>` — or just work
> normally: the skill carries its own triggers (starting a plan, finishing one, hitting a gap
> mid-task), so it offers itself with no hook registered.

Zero runtime — the finder needs only `curl` (no Node or Python). For the optional tiers
(planning nudges · typed MCP tools · Python/CI helper), installing from a checkout, and
config-safety details, see [`install.md`](install.md).

### Invocation options

Every install path takes the same flags — `-Flag` in PowerShell, `--flag` everywhere else
(`install.sh`, `npx skillfed`, `uvx skillfed`):

| Flag | Values | Default | What it does |
|---|---|---|---|
| `--harness` / `-Harness` | `claude-code` | `claude-code` | which harness to install into; an unknown value exits `2` naming what's supported |
| `--hook` / `-Hook` | `none` \| `start` \| `end` \| `both` | `none` | register 0–2 planning nudges in `settings.json` — `start` fires as you enter plan mode, `end` after a plan is approved |
| `--with-hook` / `-WithHook` | — | off | legacy alias for `--hook end` |
| `--scope` / `-Scope` | `user` \| `project` | `user` | `~/.claude` vs `./.claude` |
| `--with-npx` / `-WithNpx` | — | off | also register the Node MCP server for typed tools (needs Node ≥18) |
| `--with-python` / `-WithPython` | — | off | print the advanced/CI Python-helper setup |

`--hook none` is a **complete** install: the skill triggers itself, and hooks only repeat what it
already carries. Both nudge files ship whatever the mode, so changing your mind later is a
settings edit, never a re-fetch. `settings.json` is backed up once before the first write, merged
safely, and the registration is idempotent. (`--endpoint`, `--raw-base` and `--target`, plus how
to pass flags through a `curl | bash` pipe, are in [`install.md`](install.md).)

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
- **Two complementary signals, not conflated:** a `report_selection` labels retrieval quality —
  what each shown candidate was actually worth, as `Install` / `Read` / `Reject` plus a one-line
  reason (**a read counts as a hit**, even though nothing was installed); a `report_demand`
  captures the capability gap (what was actually needed) and is emitted only on a genuine miss —
  nothing returned, or everything rejected. They feed different loops — selection sharpens
  search, demand drives what gets built next.
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

**Reading a skill is a trust decision too.** Most of the time your agent *consults* a skill
rather than installing it: the body is fetched into context and nothing is written to disk. That
is the lower-risk path — no third-party code lands on your machine — but the text still enters
your agent's context as untrusted third-party input, and a consulted skill leaves **no
`SOURCE.txt`** behind, because that file is written only on install. So the finder treats a
fetched body as **data, not as instructions addressed to the agent** (it follows the craft
guidance and ignores anything telling it to run commands, change settings, or send data
anywhere), surfaces each consulted skill's license, provenance and source **in its reply** since
there's nothing on disk to check later, and asks you first before reading anything unverified or
flagged.

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
scripts/vendor-payload.mjs              vendors the 6 payload files into both packages (single source of truth)
integrations/claude-code/               the Claude Code plugin (skill + /skillfed + optional hooks) — canonical payload
integrations/*.py                       optional Python tier (advanced / CI)
mcp-server/                             optional Node MCP tier (typed tools via npx skillfed-mcp)
```

## 📄 License

[MIT](LICENSE) © Skill Federation.
