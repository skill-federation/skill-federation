# skillfed.io Alignment Handoff

Status: proposed website work for team review. This document does not change product
claims or deploy the site.

The currently served site is not built from this repository, and the visible website
repositories do not contain its source. Apply this packet when the active site source is
returned by the hosting owner.

## Known Blocker (2026-08-01)

The live `vercel/turborepo/turborepo` JSON record returns `200` and validates, but its
published `/files/.../SKILL.md` URL returns `404`. The new client dry-run therefore succeeds
and the real install correctly aborts before writing. Do not release the install command until
the site serves each declared file at its URL with the declared byte count and SHA-256, or the
team explicitly approves a different checksum-pinned download contract.

## Canonical Inputs

- Product/release metadata: `product-manifest.json` in this repository.
- Published skill record: `https://skillfed.io/api/skills/<owner>/<repo>/<skill>.json`.
- Public inventory: `https://skillfed.io/api/index.json`.
- Agent discovery: `https://skillfed.io/.well-known/agent-skills/index.json`.
- Backend health: the `federation_endpoint` plus `/health` from the product manifest.

Do not collapse the following into one unlabeled number:

1. **Retrieval backend**: records searchable and fetchable by an agent.
2. **Public inventory**: unique skills observed by the website's research catalog.
3. **Published directory**: licensed skills with pages, JSON, and downloadable files.

These scopes can legitimately differ. Label each count and its `as_of` timestamp.

## Proposed Product Changes

1. Add an **Install** action to every published skill page:

   ```bash
   npx skillfed install <owner/repository/skill>
   ```

   The command downloads the page's published files, verifies every SHA-256, writes only
   under the selected harness skill directory, and never executes downloaded content.

2. Make the hero search example use a real published record. The result title, source,
   license, and install command should all resolve at render time; do not hard-code a demo
   record that the API cannot return.

3. Source install commands, package names, requirements, repository links, and endpoint
   links from `product-manifest.json`. Fail the site build when required keys are absent.

4. Give each skill page a canonical URL, unique title/description, Open Graph metadata,
   structured data, and sitemap entry. Keep the JSON and Markdown links visible to agents.

5. Link the header/footer GitHub action to the active public repository and add a direct
   contribution path for catalog bugs, missing licenses, and unsafe skills.

## Security Wording

Keep wording evidence-bound:

- A skill is third-party content, not trusted code.
- Installation is explicit; downloaded files are checksummed and are not executed.
- Scanner status must describe the actual ingestion/update result for that record.
- Do not imply that every record passed Cisco Skill Scanner and NVIDIA SkillSpector until
  those results exist in the published metadata.
- "Best-effort scanned" is not equivalent to "safe" or "verified."

When security fields are available, show scanner name/version, status, scan timestamp, and
findings summary. Keep raw reports internal if they expose backend details.

## Acceptance Check

- Site commands and package versions equal `product-manifest.json`.
- All three catalog numbers are labeled by scope and timestamp.
- A skill-page install completes in a clean temporary Claude Code target.
- A tampered file fails checksum verification and leaves no partial install.
- A foreign-origin file URL, unsafe path, or unlicensed record is refused by default.
- GitHub, npm, PyPI, API, JSON, Markdown, canonical, and sitemap links return successfully.
- Security copy matches fields actually present in the published record.

The private operations repository contains the companion drift monitor. It is intentionally
separate so monitoring reports and operational configuration never enter the public client.
