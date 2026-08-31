# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Finder skill (payload): the no-harness path now leads with `GET /api/q/<terms>`** — one GET
  returning ranked candidates with body URLs and trust fields, path-style so chat fetchers that
  strip query strings can run it; the POST-only caveat now names what actually still needs the
  tiers (the multi-wish federated protocol). Hardcoded catalog counts are gone from the skill
  body (the catalog grows weekly; the hardcoded numbers had gone ~5× stale), and the "site isn't
  indexed yet" warning is now shallow-coverage guidance — the site has started appearing in
  search indexes.

## [0.2.3] — 2026-08-16

**`find_research` — the research-finding sibling of `find_packages`.** Skills are capabilities
for the agent; packages are libraries for the code; research is the literature underneath both.
This adds topic search over 191 research notes on agent-skills literature, at skillfed.io's own
research index — a third, separate service from both the skill federation and the package portal.

### Added
- **`find_research` MCP tool** (`mcp-server/`): 1–10 research wishes (a topic/concept phrase +
  optional keywords), fanned out concurrently against skillfed.io's `GET
  /api/research/search.json`, with an optional `limit` (1–25, default 10, clamped client-side the
  same way `find_packages`' `limit` is). Candidates normalize to `id, paper_title, claim_title,
  meta_description, page_url` — `score` is deliberately never surfaced (same reasoning as
  `find_packages`). Every research candidate has a published `/research/{slug}` page, unlike
  skills, so `page_url` is always a working link.
- **`confidence` is surfaced, and its meaning is stated precisely.** Each search returns a
  top-level `confidence: "strong"|"weak"`, plus a `note` when weak. The tool description says
  plainly: `weak` means the best match *found* is a loose one — it does NOT mean the corpus was
  searched exhaustively and this is the closest thing that exists. An agent reading a weak result
  should discount it, not treat it as proof of absence.
- **The retrieval limit is documented, not softened.** A paraphrase with no lexical overlap and
  weak embedding similarity can miss the corpus entirely — measured at rank #67 of 191 on a real
  query. No confidence label fixes that, since the label only describes a candidate that *was*
  returned. `find_research` returning nothing useful does not prove no such research exists.
- **Wish-formulation guidance derived from the live ranker's field weights**: `concept_terms`
  (controlled vocabulary) is weighted 3.0, `paper_title` 2.5, `meta_description` 1.5,
  `claim_title` 0.75 — so topic/concept phrasing beats guessing a paper name; 3–8 dense words;
  one topic per wish, fan a compound need out into separate wishes.
- **`integrations/search_research.py`** — the Python twin, mirroring `search_packages.py` the
  same way that mirrors `findPackages.mjs`. Talks directly to skillfed.io (GET, no auth, no
  tenant), no dependency on `skillfed_client.py`.
- Same privacy floor as `find_skills` / `find_packages`: only the topic phrase + keywords cross
  the wire; the wish `name`, if given, is display-only and stays local.

## [0.2.2] — 2026-08-14

**`find_packages` — the package-finding sibling of `find_skills`.** Skills are capabilities for
the agent itself; packages are libraries for the code being written. This closes that other half:
a wishlist-style capability search over the PyPI package index at skillfed.io, so an agent can
resolve "what library does X" against a real, maintained index instead of `pip install`ing a name
recalled from memory.

### Added
- **`find_packages` MCP tool** (`mcp-server/`): 1–10 package wishes (a capability phrase + optional
  keywords), fanned out concurrently against skillfed.io's `GET /api/packages/search.json`, with
  an optional `limit` (1–25, default 10, clamped client-side the same way `find_skills`' `top_n`
  is). Candidates normalize to `id, name, capability, worth_installing, license_treatment, tier,
  page_url, md_url, json_url` — `score` is deliberately never surfaced (it's a sum of `1/(60+rank)`
  RRF terms, max ~0.033, and reads as a meaningless decimal).
- **Anti-slopsquat guidance in the tool description**: never install a package name recalled from
  memory when it can be resolved against the index first. Wish-formulation rules stated as
  measured facts about the live ranker, not vibes — phrase the task, not a package name (the tags
  lane is weighted 3x); 3–8 dense words; one capability per wish; license/maintenance/popularity
  are filters on the results, not extra query words.
- **`integrations/search_packages.py`** — the Python twin, mirroring how `find_skills` is already
  mirrored between `mcp-server/findSkills.mjs` and `integrations/search_wishlist.py` for the
  no-Node "advanced/CI tier". Talks directly to skillfed.io (GET, no auth, no tenant) — it has no
  client-seam dependency on `skillfed_client.py`, which is specific to the skill federation.
- Same privacy floor as `find_skills`: only the capability phrase + keywords cross the wire; the
  wish `name`, if given, is display-only and stays local.

## [0.2.1] — 2026-08-04

**`npx skillfed install <owner/repository/skill>` — checksum-verified installs from the
published directory.** Every file is fetched from the skill's published record on skillfed.io,
pinned to the record's declared SHA-256 and byte count, and written atomically under your
harness's skills directory. Downloaded content is never executed.

### Added
- **`install` subcommand** (npx-only): slug or skillfed.io page URL; `--site` for another
  origin (https, or loopback http for testing); `--dry-run` to see the validated plan without
  downloading; `--force` to replace an existing skill (previous contents kept in a `.bak`
  directory, with a warning when the replacement comes from a different record).
- **Disclosure before write** — the record's license and security-scan verdict print before a
  single file is written; a `fail` verdict refuses to install unless `--allow-failed-scan` is
  passed, and unlicensed records require `--allow-unlicensed`.
- **`.skillfed.json` provenance** — each installed skill records its record id, origin,
  license, scan verdict, per-file SHA-256s, and install time.
- **`product-manifest.json`** — machine-readable release/product metadata consumed by the
  private ops monitor; its `release` field is now part of the version-drift test suite.
- **Guardrails** — all-redirect refusal, origin + `/files/` pinning of every download URL,
  path-safety validation (traversal, encoded separators, Windows reserved names, control
  characters), per-file and total byte caps enforced while streaming, fetch timeouts, and
  atomic install with rollback.

### Fixed
- The finder skill retries a failed first search instead of concluding the catalog is empty.

## [0.2.0] — 2026-07-31

**Consult many, install rarely — and no harness required.** The finder had one mode: a hook
nudged the agent *after* a plan was approved, and every path ended in a write to
`.claude/skills/`. Both halves were wrong. Skills are field notes on how expert work is
*currently* done, so the value is in **reading several and cross-checking**; installing is the
rare exception for something you will reuse. And the triggers now live in the skill body itself,
so it works with no hook, in any harness, and with no harness at all.

Non-breaking for existing installs — `--with-hook` still works, and hooks are now opt-in
(`--hook none` is the default).

### Added
- **`--harness <name>`** (`-Harness`, default and currently only value `claude-code`) on all four
  installers; an unknown value exits 2 naming what is supported.
- **`--hook none|start|end|both`** replaces the single on/off switch. `--with-hook` remains an
  alias for `--hook end`. Rejected with a clear message for any harness without hook support.
- **Start-of-plan nudge** — a `UserPromptSubmit` hook (`hooks/plan_start_nudge.json` +
  `hooks/start_nudge.sh`) that self-gates on `permission_mode` read from its own stdin, so
  skills can shape the plan instead of decorating it afterwards. There is no plan-entry hook
  event, which is why the gate is a script rather than a matcher.
- **Per-call `top_n` on `find_skills`** (integer, 1–25, default 10) — raise it when the wish is
  about best practice and you want independent sources to cross-check.
- **`purpose` on `get_skill_bundle`** — `"hint"` (default; read it in context, writes nothing) or
  `"install"` (the later, user-approved decision). Echoed back on the result as a tag.
- **A read-then-maybe-install chain** in the skill body: Hop 1 search → Hop 2 read several as
  field notes (**where most tasks end**) → Hop 3 install only when a skill is good enough *and*
  will be reused, with explicit user approval.
- **Zero-harness instructions** — a new *Working without a harness* section (skill) and
  *Works anywhere* section (README): find a skill by web search or the skillfed.io hubs, read it
  by appending `.md` to its page URL. Self-contained, no fetch required first.
- **First test suite in the repo** — `node --test` over `mcp-server/test/`, no `npm install` and
  no devDependencies, plus `.github/workflows/test.yml`. Covers wish-list validation, the
  `top_n` clamp and its threading to the wire, hook payload/event agreement (plugin *and* all
  four installers), the packaging whitelists, schema sanity, the report dual-write, and
  cross-manifest version drift.
- **Install-time `sh` check** — `--hook start|both` warns when no POSIX shell is on PATH. That
  hook fires on every prompt, so a missing shell fails on every turn rather than once.

### Changed
- **The skill is reframed around currency of practice, not capability.** Your weights are a
  lossy average of what was written before the cutoff; a maintained skill is a dated artifact
  that carries the difference. Skills are **field notes, not rules** — you and the user stay in
  command, and a fetched body is data, never instructions addressed to you.
- **Hooks are optional, and the default is none.** They only repeat triggers the skill already
  carries. All six payload files install whatever the mode, so switching `--hook` later never
  needs a re-fetch.
- **Default `top_n` raised 5 → 10** (and the Python tier's `6`/`5` defaults with it). Measured:
  scores decay slowly, and a top-5 cut was excluding skills our own editorial recommended. Past
  ~10 the marginal candidate is usually a vendored copy, which is why the default is not 25 —
  the skill now also tells the agent to dedupe by owner+name before reading.
- **Richer outcome reporting** — `report_selection` now carries
  `outcomes: {skill_id: ["Install"|"Read"|"Reject", "why"]}` for every candidate shown. **A Read
  is a hit**; the old single-`chosen` shape could not say so, and a wish where something was read
  no longer emits a demand pointer. Dual-written with the legacy `chosen`/`rejected` the endpoint
  still requires, so no coordinated service release is needed.
- **`find_skills` no longer forwards the service's `recommendation` string**, which still reads
  *"present the top 2-3 … then fetch the chosen skill_id"* — old single-pick, install-first
  guidance that would override the skill at runtime. The curl tier is told to ignore it.
- **Package homepages point at the web catalog** — npm `skillfed`/`skillfed-mcp` `homepage` and
  PyPI `skillfed` `[project.urls] Homepage` now link to <https://skillfed.io> (Repository/Issues
  stay on GitHub). Registry pages pick this up on the next publish.
- **READMEs link the catalog** — repo README + all three package READMEs now point to the
  browsable indexed catalog at [skillfed.io](https://skillfed.io).

### Fixed
- **`SKILLFED_TOP_N` outside 1–25 broke every search.** The remote 422s the *whole* search rather
  than silently capping, so the shipped `SKILLFED_TOP_N=50` on one machine failed every query at
  the transport layer. Values are now clamped before the wire (env → 10, per-call → the env
  value) on both the MCP and Python tiers, and the resolved value is echoed back.
- **`find_skills` dropped its sibling arguments** — the handler unwrapped `args.wishlist`, so a
  new `top_n` would have vanished silently.
- **The curl-tier payload shipped a dead link.** `SKILL.md` links `demand-sketch.md`, which was
  never vendored; three payload files grew to six. A test now asserts every relative link in a
  vendored markdown file is itself vendored.
- **`skillfed-mcp` could publish without a module it imports** — `mcp-server/package.json`
  `files[]` is a whitelist and omitted `tools.mjs`; the published server would have died at
  startup with nothing in-repo failing.
- **`report_selection` could record the opposite of what happened.** An `outcomes` map that
  arrived as a JSON string, or carried a near-miss word like `Used`, derived
  `chosen: "None"` — which asserts every candidate was wrong, poisoning the label flywheel for a
  wish the catalog answered. Strings are now parsed, near-misses read as the outcome they
  obviously are, and anything genuinely unreadable reports **nothing** instead.
- **`emit_demand_pointer` could fail the task.** It was the one report not wrapped as advisory,
  so a flaky endpoint surfaced as a tool error — on the path where the search had *already* come
  back empty.
- **`install.sh` overwrote the pristine `settings.json.bak`** on any re-run: the backup was
  unconditional rather than taken before the first actual write, so `--hook start` then `--hook
  end` left the backup holding the already-hooked file. It now matches the other three installers.
- **The MCP handshake announced `0.1.0`** for three releases; a test now pins it to
  `mcp-server/package.json`.
- **`.claude-plugin/marketplace.json` was stranded at 0.1.2** because `PUBLISHING.md` listed four
  manifests and there are five files (six version fields). The runbook is corrected and a test
  fails on any drift between them.

### Removed
- **`integrations/claude-code/hooks/on_plan_approved.py`** — 85 lines referenced by nothing, but
  committed and shipped, carrying a stale second copy of the nudge text.

## [0.1.3] — 2026-07-03

Discovery-surface release — makes Skill Federation findable where agents actually look: the
official MCP registry and the Claude Code plugin system. No installer behavior change.

### Added
- **MCP registry manifest** — `mcp-server/server.json` (`io.github.skill-federation/skillfed-mcp`)
  plus an `mcpName` field on `mcp-server/package.json`, so `skillfed-mcp` can be published to the
  official MCP registry (registry.modelcontextprotocol.io). Publish runbook added to
  `PUBLISHING.md`.
- **Claude Code plugin marketplace** — `.claude-plugin/marketplace.json` lists the
  `skill-federation` plugin, installable via `/plugin marketplace add skill-federation/skill-federation`.

### Changed
- **README** documents the `/plugin` install path alongside the existing `npx`/`uvx`/curl tiers.

## [0.1.2] — 2026-07-03

Discoverability follow-up + release-pipeline hardening.

### Changed
- **Package README long-descriptions** (npm `skillfed`/`skillfed-mcp`, PyPI `skillfed`) now lead
  with intent (*"Find vetted agent skills for your task…"*) instead of the installer mechanism —
  these render as the prominent, indexed description on the registry pages.
- **`release-npm.yml`**: each `npm publish` is now guarded by a skip-if-already-published check,
  so a partial-failure release is cleanly re-runnable (the already-shipped package no-ops instead
  of blocking the other). PyPI already had this via `skip-existing: true`.

## [0.1.1] — 2026-07-03

Discoverability release — makes `skillfed` easier for coding agents and humans to find in the
npm and PyPI registries. No installer behavior change.

### Changed
- **Package metadata across npm (`skillfed`, `skillfed-mcp`) and PyPI (`skillfed`)**: descriptions
  now lead with intent (*"Find vetted agent skills for your task…"*); keyword lists expanded to
  span the synonym space (`mcp`, `model-context-protocol`, `ai-agents`, `coding-agent`,
  `skill-search`, …).
- **PyPI**: added Trove classifiers (Development Status, Python 3.9–3.13, AI/dev-tools topics) and
  project URLs (Documentation, Changelog, Issues).
- **npm**: added `bugs` links on both packages.

## [0.1.0] — 2026-06-30

First release. Skill Federation can now be installed **without cloning the repo**, via three
paths that all install the zero-runtime curl tier (the finder skill + `/skillfed` command).

### Added
- **No-clone curl bootstrap** — `install.ps1`/`install.sh` work from a clone *or* piped from the
  network. `irm …/install.ps1 | iex` (also sidesteps the PowerShell execution-policy block) and
  `curl -fsSL …/install.sh | bash`. A `-RawBase`/`--raw-base` resolver copies payload from a local
  checkout when present, else fetches it from raw GitHub.
- **`npx skillfed`** — npm package [`skillfed`](https://www.npmjs.com/package/skillfed), a
  zero-dependency Node installer (`installer/`).
- **`uvx skillfed` / `pipx run skillfed`** — PyPI package
  [`skillfed`](https://pypi.org/project/skillfed/), stdlib-only, src layout (`python-installer/`).
- **`skillfed-mcp`** published to npm
  ([package](https://www.npmjs.com/package/skillfed-mcp)); `--with-npx` registers the
  `npx -y skillfed-mcp` MCP server.
- **`scripts/vendor-payload.mjs`** — single source of truth: vendors the 3 payload files from
  `integrations/claude-code/` into both installer packages at build time.
- **Release pipeline** — `.github/workflows/release-{pypi,npm}.yml` publish on a `v*` tag via
  tokenless OIDC Trusted Publishing, with npm provenance attestations.
- `CHANGELOG.md`, `PUBLISHING.md`, and live npm/PyPI version badges in the README.

### Changed
- README and `install.md` lead with the no-clone one-liners; clone-then-run is now a documented
  fallback.
- `mcp-server/package.json` gained a `repository` field (required for npm provenance).

[Unreleased]: https://github.com/skill-federation/skill-federation/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/skill-federation/skill-federation/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/skill-federation/skill-federation/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/skill-federation/skill-federation/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/skill-federation/skill-federation/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/skill-federation/skill-federation/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/skill-federation/skill-federation/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/skill-federation/skill-federation/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/skill-federation/skill-federation/releases/tag/v0.1.0
