# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/skill-federation/skill-federation/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/skill-federation/skill-federation/releases/tag/v0.1.0
