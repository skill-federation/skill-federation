# Security Policy

Skill Federation is a security tool: it exists to keep untrusted third-party skills from reaching
your agent unfiltered. We take vulnerabilities in it seriously, and we want to hear about them.

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Use GitHub's private reporting:
**[Report a vulnerability](https://github.com/skill-federation/skill-federation/security/advisories/new)**
(repo → **Security** → **Report a vulnerability**). This opens a private advisory only maintainers
can see.

Include, as far as you can:
- what component is affected — the finder, an installer (`curl` / `npx` / `uvx`), the MCP server, or
  the catalog/scanning pipeline;
- a description and, ideally, a minimal reproduction;
- the impact you believe it has.

We aim to acknowledge a report within a few days and to keep you updated as we work a fix. We'll
credit reporters who want it once a fix ships.

## Scope

In scope:
- **The client** — the finder, installers, and MCP server in this repo. Especially anything that
  could cause more than the abstract wish to leave a user's machine (a privacy-floor break), or
  arbitrary code execution during install.
- **The catalog / scanning pipeline** — a way to get a malicious or vulnerable skill promoted past
  the ingest scan and served to users.

Out of scope:
- Vulnerabilities in an upstream skill's *original* repository that are caught by our scan and never
  served (report those upstream). If a bad skill is actually **served by the federation**, that's in
  scope — see below.

## Reporting a malicious or vulnerable skill in the catalog

If a skill served by the federation looks malicious, vulnerable, or misattributed, report it the
same private way and include the skill's `id` and `source_url` (both are in the `SOURCE.txt`
installed next to every skill). We'll pull it for re-scan and remove it if it fails.

## How the catalog is protected

Every candidate is served from an **internal, pre-scanned registry** — never fetched live from the
wild repo. At ingestion each skill is copied, de-duplicated, and best-effort scanned with two
independent tools:

- **[Cisco AI Defense Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner)**
- **[NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector)**

High/critical findings are rejected or routed to manual review before promotion.

> **Best-effort, not a guarantee.** As Cisco's scanner puts it, *"no findings ≠ no risk."* A clean
> scan is not proof a skill is safe. The federation still shows each skill's license, provenance,
> and source, and **nothing installs without your approval.** Treat installed skills as code you are
> choosing to run with your agent's full permissions.
