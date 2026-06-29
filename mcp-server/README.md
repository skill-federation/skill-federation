# skillfed-mcp — optional Node MCP server

> **This is the optional Node tier.** The **default** Skill Federation install is the
> runtime-free **curl-based plugin** under `../integrations/claude-code/` — it needs no
> Python and no Node and works on the standalone Claude Code desktop build. Use this Node
> server only if you're on the **npm Claude Code CLI** (or otherwise have **Node ≥18**) and
> want Claude to call the federation as first-class MCP tools (no shell-out).

It exposes the same hosted federation as four MCP tools over stdio:

| Tool | Maps to | Purpose |
|---|---|---|
| `find_skills` | `/search` (per wish, fanned out) | lexical-recall search over a wish-list |
| `get_skill_bundle` | `/fetch` | fetch a confirmed match's files for install |
| `report_selection` | `/report_selection` | per-wish agentic-selection label |
| `emit_demand_pointer` | `/report_demand` | structured sketch on an empty-retrieval miss |

The request/response shapes are identical to the curl plugin's `/search`, `/fetch`,
`/report_selection`, and `/report_demand` calls.

## Requirements

- **Node ≥18** (global `fetch` + stable `fs`). Not present on the standalone Claude Code
  desktop build — check with `node --version`.

## Register it

Add to your project `.mcp.json` (or `~/.claude.json`). The server installs nothing for you —
`npx` fetches and caches it on first use.

**Release (published to npm):**
```json
{
  "mcpServers": {
    "skillfed-mcp": {
      "command": "npx",
      "args": ["-y", "skillfed-mcp"],
      "env": { "SKILLFED_ENDPOINT": "https://qurini-skill-federation.hf.space" }
    }
  }
}
```

**Local dev (from this repo):** `npm install` here once (for `@modelcontextprotocol/sdk`), then
```json
{
  "mcpServers": {
    "skillfed-mcp": {
      "command": "node",
      "args": ["<abs path>/mcp-server/index.mjs"],
      "env": { "SKILLFED_ENDPOINT": "https://qurini-skill-federation.hf.space" }
    }
  }
}
```

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `SKILLFED_ENDPOINT` | _(required)_ | hosted federation URL |
| `SKILLFED_API_KEY` | _(none)_ | bearer token (qurini demo is keyless) |
| `SKILLFED_TENANT` | `$USER`/`$USERNAME`/`local` | tenant id |
| `SKILLFED_TOP_N` | `3` | candidates per wish |
| `SKILLFED_K` | `4` | paraphrase formulations concatenated per query |

## Test without Claude

```bash
npm install
npx @modelcontextprotocol/inspector node index.mjs
# then call find_skills with ../integrations/sample_wishlist.json
```
