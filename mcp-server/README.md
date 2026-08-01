# skillfed-mcp — optional Node MCP server

**Find vetted agent skills for your task** — exposes the Skill Federation finder to Claude and
any MCP client as first-class MCP tools (`find_skills`, `get_skill_bundle`). The indexed catalog
it searches is browsable on the web at [skillfed.io](https://skillfed.io).

> **This is the optional Node tier.** The **default** Skill Federation install is the
> runtime-free **curl-based plugin** under `../integrations/claude-code/` — it needs no
> Python and no Node and works on the standalone Claude Code desktop build. Use this Node
> server only if you're on the **npm Claude Code CLI** (or otherwise have **Node ≥18**) and
> want Claude to call the federation as first-class MCP tools (no shell-out).

It exposes the same hosted federation as four MCP tools over stdio:

| Tool | Maps to | Purpose |
|---|---|---|
| `find_skills` | `/search` (per wish, fanned out) | lexical-recall search over a wish-list; optional `top_n` (1–25, default 10) |
| `get_skill_bundle` | `/fetch` | fetch a skill's full text — **to consult, or to install**: `purpose: "hint"` (default) reads it in context and writes nothing; `purpose: "install"` is the later, user-approved decision |
| `report_selection` | `/report_selection` | what each shown candidate was worth: `outcomes` maps `skill_id → ["Install"\|"Read"\|"Reject", reason]`. **A Read is a hit** |
| `emit_demand_pointer` | `/report_demand` | demand on a genuine miss (empty OR everything rejected — never when you read something): `wish` + a `sketch` **string** per `demand-sketch.md` |

The request/response shapes are identical to the curl plugin's `/search`, `/fetch`,
`/report_selection`, and `/report_demand` calls, with two client-side conveniences:

- **`top_n` is clamped, not forwarded blindly.** The remote 422s the *entire* search for a value
  outside `1..25` (it does not silently cap), so the client resolves per-call `top_n` →
  `SKILLFED_TOP_N` → `10`, clamps it into range, sends that, uses it to truncate results, and
  echoes the resolved value back to you.
- **`report_selection` dual-writes.** The endpoint still requires a non-empty `chosen`, so the
  client derives the legacy `chosen`/`rejected` from `outcomes` (the Install if there was one,
  else the most useful Read, else the literal `"None"` when *every* label read as a Reject) and
  sends both. It **fails closed**: an `outcomes` that can't be read — wrong type, unparseable,
  empty, or labels outside `Install|Read|Reject` — reports nothing rather than falling back to
  `"None"`, because `"None"` asserts that every candidate was wrong and would poison the label
  flywheel. You get `{"reported": false, "note": …}` telling you what to fix. (A JSON *string* is
  parsed before giving up, and near-miss words like `Used` or `read it` are read as `Read`.)

Both reports are **advisory** — `report_selection` and `emit_demand_pointer` swallow a non-2xx
with a note on stderr and hand back `{"reported": false, "note": …}`. Neither can fail your task;
a demand pointer fires on the path where the search *already* came back empty.

`emit_demand_pointer` still needs a non-empty `wish`, and its `sketch` is a **string**, not an
object.

The service's own `recommendation` string is **not** forwarded by `find_skills`: it still reads
*"present the top 2-3 … then fetch the chosen skill_id"* — old single-pick, install-first
guidance that would contradict the skill at runtime. The curl tier sees it raw and is told to
ignore it.

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
| `SKILLFED_TOP_N` | `10` | candidates per wish, **1–25**; out-of-range values are clamped and unparseable ones fall back (env → `10`, per-call → the env value), never sent raw. A per-call `top_n` on `find_skills` overrides it |
| `SKILLFED_K` | `4` | paraphrase formulations concatenated per query |

**On `top_n`.** The default is 10 because a top-5 cut measurably drops good, genuinely distinct
skills, while past ~10 the marginal candidate is usually a vendored or translated copy of one you
already have — raise it for "what is current best practice here" wishes, where you want several
independent sources to cross-check, and dedupe by owner+name before reading. The `1..25` bound is
**measured against the live service, not contractual**; re-probe if searches start 422-ing.

## Test without Claude

```bash
npm install
npx @modelcontextprotocol/inspector node index.mjs
# then call find_skills with ../integrations/sample_wishlist.json
```
