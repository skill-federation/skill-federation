---
name: github-discoverability
description: Make a GitHub repo or Agent Skill discoverable across the skill-aggregator ecosystem — GitHub topics, scraper-visible SKILL.md paths, instant directories (awesomeskills.dev / SkillsMP), gh skill + agentskills.io conformance, and the MCP registry. Use when someone wants their skill or repo to be "found", indexed, listed in registries/directories, surfaced by skill scrapers, or asks how aggregators discover projects on GitHub.
allowed-tools: Bash, Read, Edit, WebFetch
---

# GitHub discoverability for Agent Skills

Get a repo or skill **found** by the tools people actually use to discover skills:
automated scrapers, curated lists, and registries. This is a distribution playbook,
not generic SEO — it targets the specific signals the skill ecosystem keys on.

> **Do it honestly.** Real project, real value, one accurate entry per destination.
> Topics must be genuinely relevant; descriptions come from the actual `SKILL.md`.
> Keyword-stuffing topics or spraying low-effort PRs across many lists gets a project
> **removed** from curated lists — it's negative-sum. When a curator declines, that's
> their call; don't re-submit.

## How discovery actually works (three lanes)

1. **Automated scrapers** (SkillsMP/awesomeskills.dev, GitHub `/topics` pages, `gh skill`).
   They key on **GitHub topics** and on **`SKILL.md` files at conventional paths**. Zero
   human in the loop — conform to the convention and you're indexed.
2. **Curated "awesome" lists** (VoltAgent, travisvn, ComposioHQ, tech-leads-club).
   Manual PRs, human review. Higher trust, but most **reject brand-new skills** and
   require social proof / real usage.
3. **Registries** (agentskills.io spec, `registry.modelcontextprotocol.io` for MCP
   servers). Conformance + being on GitHub is the entry condition.

## Playbook — run in this order

**1. Put `SKILL.md` where scrapers look.** The single most common miss: the skill lives
at a nested path (e.g. `integrations/foo/skills/x/SKILL.md`) that naive tree-walkers never
reach. Scrapers expect **root `SKILL.md`** or **`skills/<name>/SKILL.md`**. If your
canonical source lives elsewhere, mirror a *committed* copy to `skills/<name>/` and guard
it in CI so it can never drift (see [reference.md](reference.md) → "Mirror + drift guard").

**2. Set GitHub topics** — the highest-leverage free signal; topic-scrapers and GitHub's
own `/topics/*` pages both index them. Use the accurate core set (see reference.md). Set
via `gh repo edit --add-topic ...` or the REST `PUT /repos/{o}/{r}/topics`.

**3. Submit to instant directories.** awesomeskills.dev/SkillsMP has a no-moderation
[submit form](https://www.awesomeskills.dev/en/submit) that auto-parses your `SKILL.md`.
**Paste the repo-root URL, not a subfolder deep-link** — the auto-detector walks the tree,
and deep-links can error while the root URL succeeds.

**4. Conform to the open spec** so `gh skill search` and agentskills.io index you: valid
frontmatter (`name` + `description` minimum) and the `SKILL.md`-in-a-folder layout. No
separate submission needed — conformance + public GitHub is the entry condition.

**5. Publish to the MCP registry** *if* you ship an MCP server: keep `server.json` in
lockstep with the published npm version and run `mcp-publisher`. See reference.md.

**6. Curated lists LAST, and only when mature.** VoltAgent and travisvn explicitly reject
just-created skills ("give your skill time to mature and gain users"). Submitting a day-old
repo wastes goodwill and gets declined. Wait for stars/usage, then open **one** honest PR
per list after reading its `CONTRIBUTING.md` and checking its interaction limits.

## Gotchas (hard-won)

- **Nested `SKILL.md` is invisible** to convention scrapers → always expose a root-level path.
- **awesomeskills.dev**: repo-root URL works; subfolder deep-link can return "Failed to save".
- **Curated lists gate on maturity** — brand-new self-submissions are rejected by rule.
- **Over-optimizing backfires** — irrelevant topics and duplicate PRs get you delisted.
- **A generated/mirrored copy will drift** unless a CI check regenerates it and fails on diff.

## Verify

- Topics: open `https://github.com/topics/<topic>` and confirm the repo appears.
- Directory: search the directory's site/API for the repo name.
- MCP registry: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=<name>"`.
- Spec: `gh skill search <name>` (once the root `SKILL.md` is on the default branch).

See [reference.md](reference.md) for exact commands, endpoints, the recommended topic set,
the mirror + drift-guard pattern, and the per-destination checklist.
