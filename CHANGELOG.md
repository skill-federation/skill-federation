# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Instant search preview** — `npx skillfed find "<abstract capability wish>"` searches the live
  catalog without installing anything, displays distinct trust-aware candidates, and supports
  `--json` for scripting. It over-fetches before collapsing duplicate skill names so mirrored
  catalog entries do not consume the visible result slots. Existing installer behavior is unchanged.

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

[Unreleased]: https://github.com/skill-federation/skill-federation/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/skill-federation/skill-federation/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/skill-federation/skill-federation/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/skill-federation/skill-federation/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/skill-federation/skill-federation/releases/tag/v0.1.0
