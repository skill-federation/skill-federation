# skillfed-mcp — optional Node MCP server

**Find vetted agent skills for your task, PyPI packages for your code, and the research behind
both** — exposes the Skill Federation finder to Claude and any MCP client as first-class MCP
tools (`find_skills`, `find_packages`, `find_research`, `get_skill_bundle`). The indexed catalogs
are browsable on the web at [skillfed.io](https://skillfed.io).

**`find_skills` vs. `find_packages` vs. `find_research`.** Skills are capabilities for the *agent
itself* — how to do a task. Packages are libraries for the *code being written* — what the
program imports. Research is the literature underneath both — the papers, benchmarks, and
measured claims. Reach for `find_packages` when you're about to `pip install` something recalled
from memory, unsure which package does X, comparing alternatives to a package you already know,
or verifying a remembered package name is real and maintained — never install a name recalled
from memory when it can be resolved against the index first (a hallucinated or squatted name is a
supply-chain risk the index removes for free). Reach for `find_research` when you want the
measured claim behind a design choice — a benchmark, an ablation, a failure rate — rather than a
library or a skill.

> **This is the optional Node tier.** The **default** Skill Federation install is the
> runtime-free **curl-based plugin** under `../integrations/claude-code/` — it needs no
> Python and no Node and works on the standalone Claude Code desktop build. Use this Node
> server only if you're on the **npm Claude Code CLI** (or otherwise have **Node ≥18**) and
> want Claude to call the federation as first-class MCP tools (no shell-out).

It exposes six MCP tools over stdio — four over the hosted **skill** federation, plus one each
over the separate **package** and **research** portal indexes:

| Tool | Maps to | Purpose |
|---|---|---|
| `find_skills` | `/search` (per wish, fanned out) | lexical-recall search over a wish-list; optional `top_n` (1–25, default 10) |
| `find_packages` | skillfed.io `/api/packages/search.json` (per wish, fanned out) | capability search over the PyPI package index — a **different service** from the skill federation above, GET-only, no auth, no tenant; optional `limit` (1–25, default 10) |
| `find_research` | skillfed.io `/api/research/search.json` (per wish, fanned out) | topic search over 191 research notes on agent-skills literature — **another different index**, same GET/no-auth/no-tenant shape as `find_packages`; optional `limit` (1–25, default 10) |
| `get_skill_bundle` | `/fetch` | fetch a skill's full text — **to consult, or to install**: `purpose: "hint"` (default) reads it in context and writes nothing; `purpose: "install"` is the later, user-approved decision |
| `report_selection` | `/report_selection` | what each shown candidate was worth: `outcomes` maps `skill_id → ["Install"\|"Read"\|"Reject", reason]`. **A Read is a hit** |
| `emit_demand_pointer` | `/report_demand` | demand on a genuine miss (empty OR everything rejected — never when you read something): `wish` + a `sketch` **string** per `demand-sketch.md` |

`find_packages` normalizes each candidate to `id, name, capability, worth_installing,
license_treatment, tier, page_url, md_url, json_url`. `find_research` normalizes to `id,
paper_title, claim_title, meta_description, page_url` — every research candidate has a published
`/research/{slug}` page, so `page_url` is always a working link (unlike skills, where most are
not). **`score` is deliberately dropped from both** — it's a sum of `1/(60+rank)` RRF terms (max
~0.033) and reads as a meaningless decimal, not a signal to act on.

**`find_research`'s `confidence` is surfaced, and it means something narrower than it sounds.**
Every search returns a top-level `confidence: "strong"|"weak"`, plus a `note` when weak. **`weak`
means the best match *found* is a loose one — it does NOT mean the corpus was searched
exhaustively and this is the closest thing that exists.** Discount a weak result; do not treat it
as evidence of absence. There is also a real retrieval ceiling under that label: a paraphrase with
no lexical overlap and weak embedding similarity can miss the corpus entirely — measured at rank
**#67 of 191** on a real query. No confidence label rescues that miss, because confidence only
describes a candidate that *was* returned. So an empty or weak `find_research` result never
proves no such research exists.

The request/response shapes of the four **skill**-federation tools are identical to the curl
plugin's `/search`, `/fetch`, `/report_selection`, and `/report_demand` calls, with two
client-side conveniences (`find_packages` and `find_research` have no curl-tier counterpart —
they only exist here and in the optional Python `integrations/` tier, see below):

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
| `SKILLFED_PACKAGES_ENDPOINT` | `https://skillfed.io` | portal origin queried by `find_packages` — a separate service, not `SKILLFED_ENDPOINT` |
| `SKILLFED_PKG_LIMIT` | `10` | candidates per wish for `find_packages`, **1–25**, clamped the same way as `SKILLFED_TOP_N`. A per-call `limit` overrides it |
| `SKILLFED_RESEARCH_ENDPOINT` | `https://skillfed.io` | portal origin queried by `find_research` — same host as `find_packages` by default, but a distinct index; not `SKILLFED_ENDPOINT` |
| `SKILLFED_RESEARCH_LIMIT` | `10` | candidates per wish for `find_research`, **1–25**, clamped the same way as `SKILLFED_PKG_LIMIT`. A per-call `limit` overrides it |

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
# or find_packages with ../integrations/sample_package_wishlist.json
# or find_research with ../integrations/sample_research_wishlist.json
```
