# Reference — exact channels, commands, and patterns

## Recommended GitHub topic set

Pick the ones that are genuinely true of the project. A skill-ecosystem repo typically fits:

```
agent-skills  claude-skills  claude-code  skill-discovery  skill-search
mcp  ai-agents  skillsmp
```

`skillsmp` and `skill-md-skillsmp` are watched by the SkillsMP scraper specifically. Add
language/domain topics only when accurate. Do **not** pad with unrelated tags.

Set them:

```bash
# GitHub CLI
gh repo edit <owner>/<repo> --add-topic agent-skills,claude-skills,claude-code,skill-discovery,skill-search,mcp,ai-agents,skillsmp

# Or REST (works with any repo-scoped token; no gh needed)
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/topics \
  -d '{"names":["agent-skills","claude-skills","claude-code","skill-discovery","skill-search","mcp","ai-agents","skillsmp"]}'
```

Web UI fallback: repo home → About (gear icon) → Topics.

## Mirror + drift guard (when canonical SKILL.md lives at a nested path)

Keep one source of truth; emit a *committed* root-level copy scrapers can see.

1. In your build/vendor script, copy the canonical skill folder to `skills/<name>/` and
   commit it (do **not** gitignore it — scrapers read the committed tree).
2. Add a CI job that regenerates and fails on drift:

```yaml
# .github/workflows/skill-sync.yml (essential steps)
- run: node scripts/vendor-payload.mjs        # your generator
- name: Fail on drift
  run: |
    drift="$(git status --porcelain -- skills/)"   # catches modified AND new-untracked
    [ -z "$drift" ] || { echo "::error::skills/ out of sync — regenerate & commit"; echo "$drift"; exit 1; }
```

`git status --porcelain` is deliberate: plain `git diff` misses a *new* sibling file the
generator copies in.

## Instant directories (no moderation)

| Directory | How | Notes |
|---|---|---|
| **awesomeskills.dev / SkillsMP** | https://www.awesomeskills.dev/en/submit | Paste **repo-root URL** — the subfolder deep-link is unreliable (errors or silently fails to persist). Root URL auto-parses `SKILL.md` and appears immediately. A repo with several skills gets its extra skills on the next crawl, not per-submit. Verify: `https://www.awesomeskills.dev/en/search?q=<term>` or `curl "https://skillsmp.com/api/v1/skills/search?q=<term>"`. |

Requirement it enforces: public repo + `SKILL.md` in root **or** `skills/SKILL.md` **or**
`README.md` fallback + clear name/description.

## Registries

- **agentskills.io** — the open spec. No submission; `SKILL.md` with `name`+`description`
  and folder layout = conformant. `gh skill search <name>` indexes conformant public repos.
- **MCP registry** (`registry.modelcontextprotocol.io`) — only if you ship an MCP server.
  Keep `server.json` version == the live npm version (registry validates against npm), then:
  ```bash
  mcp-publisher login github
  mcp-publisher publish            # reads ./server.json
  curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=<name>"
  ```
  Gotchas: publishing requires the npm version to be live first; org-namespaced names need
  public org membership; descriptions should stay short/ASCII; a version can't be re-published.

## Curated lists (manual PRs — maturity-gated)

Open **one** honest entry per list, after reading its `CONTRIBUTING.md` and checking whether
it accepts new skills. Priority order:

| List | Format | Gate |
|---|---|---|
| [tech-leads-club/agent-skills](https://github.com/tech-leads-club/agent-skills) | catalog folder, Snyk-scanned | validated registry; adds a skill folder |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | table `**[name](link)** — desc` | requires **social proof**; strict anti-promotion |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | `**[author/skill](link)** - desc` (≤10 words), grouped | **rejects brand-new skills**; needs real usage |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | list entry | mostly hosts its own skills |

If a list has interaction limits set to collaborators-only, you can't submit until they
lift — don't burn effort on a PR that can't be accepted.

## What not to do

- No irrelevant/padded topics (dilutes precision, risks delisting).
- No duplicate or templated PRs across many lists.
- No submitting brand-new self-owned skills to maturity-gated curated lists.
- No fake stars/engagement.
