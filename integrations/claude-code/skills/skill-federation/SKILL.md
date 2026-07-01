---
name: skill-federation
description: Find vetted agent skills for the current task from a federated catalog, the privacy-preserving way. Use right after a plan is approved, when you hit a capability gap mid-task, or when the user asks to find/discover a skill ("/skillfed …", "is there a skill that…"). You generate an abstract wish-list (never the plan) and the federation matches it.
allowed-tools: Bash, Read, Write, Glob
---

# Skill Federation — wish-list finder

Discover vetted agent skills **without ever sending the user's plan, brief, or work
across the boundary**. You reason about the *ideal* skills for the task, emit an
abstract wish-list, and the federation matches those wishes against its catalog.

> **Privacy floor (constitution Principle IV) — non-negotiable.** What leaves the machine is only
> the abstract wish — its one-line `description`, its ~4 paraphrased `formulations`, 1–5
> `keywords`, and its structured capability `sketch` (per [demand-sketch.md](demand-sketch.md)).
> The sketch's flattened terms ride **inside the search query on every search** (and on a miss the
> same sketch is the demand pointer). (The wish `name` is display-only and stays local; the search
> payload is the concatenated description + formulations + flattened sketch, plus keywords.) Every
> field stays at the "what skill should exist" abstraction. The plan, brief, outputs, file
> contents, and your reasoning trace MUST NOT appear in any description, formulation, keyword,
> sketch, or search payload. If you can't phrase a need without quoting the user's content,
> abstract it until you can.

## When to use

- A plan was just approved (the plan-approval hook nudges you here).
- You're about to build something a packaged skill likely already does (PDF
  extraction, market sizing, PR review, SQL reporting, resume tailoring, …).
- The user says "find a skill for…", "is there a skill that…", or runs `/skillfed`.

> **Don't skip silently.** If you conclude a plan needs no skill search (e.g. bespoke work on your
> own codebase), say so **explicitly** — name the capabilities you considered and why none needs a
> federated skill — and **confirm with the user** before proceeding without a search.

## Backend — MCP tools if present, else `curl`

**If the `skillfed-mcp` MCP tools are available this session** (`find_skills`,
`get_skill_bundle`, `report_selection`, `emit_demand_pointer` — the optional Node/npx tier),
**use them**: they hit the same federation with typed, validated I/O and no shell-out. The
wish-list, selection, trust, and reporting logic below are identical — just call the tool
instead of the matching `curl` POST (`find_skills` ≙ `/search`, `get_skill_bundle` ≙ `/fetch`,
`report_selection` ≙ `/report_selection`, `emit_demand_pointer` ≙ `/report_demand`).

**Otherwise (the default), use `curl`** — it ships with Windows 10+ (`curl.exe`) and macOS
(`/usr/bin/curl`), so the finder needs **no Python, no Node, no install**. You run `curl`
through your shell (Bash) tool.

- **Endpoint**: use `$SKILLFED_ENDPOINT` if it's set, else default
  `https://qurini-skill-federation.hf.space` (the keyless demo). Point it at our own
  federation core later — the request/response shapes are unchanged.
- **Defaults**: `top_n` = 5 candidates per wish; ~4 paraphrases per wish.
- **Windows note**: in PowerShell, `curl` is an alias for `Invoke-WebRequest` — call
  **`curl.exe`** explicitly. On macOS/Linux plain `curl` is fine.
- **Quoting-safe pattern**: write each JSON request body to a temp file and send it with
  `--data-binary "@<file>"`, so no shell has to escape braces or quotes.

The federation operations below are one `curl` POST each — `/search`, `/fetch`,
`/report_selection`, `/report_demand`. (The endpoint also exposes `/report_outcome` for
post-use signals; that's out of scope for the finder.)

## The flow (two hops; always user-approved before install)

### Hop 1 — search

1. **Form an expected-response sketch, then a wish-list.** For the task, imagine the
   *ideal* skill(s): what each would do, its inputs/outputs, the key operations, and the
   discriminative vocabulary its SKILL.md would contain. Emit that sketch as a real
   `sketch` field on each wish (it powers the search query *and* becomes the demand
   pointer on a miss — author it once, per [demand-sketch.md](demand-sketch.md)). Then
   write **up to 10 wishes** — fewer is fine — each:
   - `name`: short hypothetical skill name (display-only, stays local),
   - `description`: **one line** for display only (the wish→match table) — abstract, no
     plan specifics,
   - `keywords`: **1–5 required** evidence terms the description omits but the target
     skill's docs would contain (the discriminative subset of `sketch.domain_vocab`),
   - `formulations`: **~4 paraphrases** of the description with *deliberately varied
     vocabulary* (synonyms, alternate framings). The load-bearing recall field — a single
     phrasing misses ~20% of the time; 4 concatenated paraphrases erase that (BM25 is
     bag-of-words, so they form a robust term-union query). Keep each abstract; never
     quote the plan/brief.
   - `sketch`: the structured expected-response sketch — `purpose / inputs / outputs /
     operations / domain_vocab / section_sketch / tags` (demand-sketch.md schema). Its
     flattened term values are appended to the search query, so the single BM25 call sees
     the full discriminative vocabulary a matching SKILL.md would contain (SIRA step iii),
     not just the 1–5 keywords. Keep it terse and capability-level — never task data.

2. **Search each wish with `curl` (`/search`).** For each wish, concatenate its
   `description` + `formulations` + the flattened `sketch` term values into ONE
   bag-of-words query string (BM25 is bag-of-words, so the concatenation is a robust
   term-union — matches a K-request ensemble at 1/K the cost; the sketch supplies the rare,
   discriminative vocabulary SIRA rewards). Flatten the sketch to its *values* only
   (`domain_vocab`, `operations`, `inputs`, `outputs`, `purpose`, `section_sketch`, `tags`)
   — never JSON keys or punctuation. Write the request body to a temp file and POST it:

   ```bash
   # body.json  →  { "tenant":"local",
   #                 "wish":"<description + formulations + flattened sketch, space-joined>",
   #                 "keywords":["1-5","evidence","terms"], "top_n":5 }
   curl.exe -s --max-time 20 -X POST "$SKILLFED_ENDPOINT/search" \
     -H "Content-Type: application/json" --data-binary "@body.json"
   ```
   Response per wish:
   ```json
   { "query_id":"q_…",
     "candidates":[ { "skill_id":"…","name":"…","description":"…","score":0.27,
       "trust":{"license":"MIT","license_class":"permissive","provenance":"verified","stars":null},
       "source_url":"https://…" } ],
     "confidence":0.59, "recommendation":"…" }
   ```
   Keep each wish's `query_id` (needed for selection reporting). Empty `candidates` →
   demand case. Run the wishes in turn (≤10; each is <300 ms) — or issue them in parallel.

3. **Drop already-installed skills.** Before showing matches, `Glob`
   `~/.claude/skills/*/SKILL.md` and `./.claude/skills/*/SKILL.md`, read each skill's
   frontmatter `name`, and remove any candidate whose name matches (normalize: lowercase,
   non-alphanumerics → `-`). Don't re-recommend something the user already has.

### Selection (your job — precision)

4. **Agentic selection, per wish.** Each `/search` returns ≤k recall candidates; *you*
   decide. For each wish: pick the single best candidate, or reject all. A high score
   is not approval — judge fit against the actual need.
5. **Surface trust BEFORE approval.** Show the user a wish→match table with each
   candidate's `license_class` (permissive / copyleft / proprietary / review),
   `provenance` (verified / unverified), `stars`, `source_url`, and a ⚠ for any
   `security_flags`. Prefer permissive + verified; call out review/unverified ones.
   **Never install without explicit user approval.**

### Hop 2 — local resolution (local-first)

6. For each approved match, check whether it's already installed at
   `.claude/skills/<id>/` (existence check — that *is* "local search"). If present,
   use the local copy as-is (local-first rule; a drifted local copy is personalization,
   not corruption). If absent, fetch the bundle with `curl` (`/fetch`):
   ```bash
   # body.json  →  { "tenant":"local", "skill_id":"<skill_id>" }
   curl.exe -s --max-time 20 -X POST "$SKILLFED_ENDPOINT/fetch" \
     -H "Content-Type: application/json" --data-binary "@body.json"
   # → { "skill_id","name","license","source_url", "body":"<full SKILL.md content>" }
   #   (an in-house bundle may instead return "files":{ "SKILL.md":…, … } — handle both)
   ```
   Write the returned `body` (or each `files` entry) to `.claude/skills/<id>/SKILL.md`
   and record a `.federation.json` manifest (`skill_id`, `installed_at`, `source_url`/
   `license` for OSS). Surface attribution at install.
7. **Use or revise.** Run the installed skill. If it needs local adaptation for this
   task, stage the change as a LOCAL update on the installed copy (drift) — never push
   local edits back. A general improvement that isn't tenant-specific is a FEDERATED
   suggestion instead. (Full reflection/suggestion chain is a later task; keep it light.)

### Report outcomes — two complementary reports

8. For every wish that **had candidates**, report the selection with `curl`
   (`/report_selection`, per wish, with its `query_id`). `chosen` must be a **non-empty
   string** — the selected id, or the literal `"None"` if you rejected every candidate:
   ```bash
   # body.json  →  { "tenant":"local", "query_id":"<query_id>",
   #                 "chosen":"<id-or-'None'>", "rejected":["<id>","…"] }
   curl.exe -s --max-time 20 -X POST "$SKILLFED_ENDPOINT/report_selection" \
     -H "Content-Type: application/json" --data-binary "@body.json"
   ```
   `"chosen":"None"` records that the shown candidates were all wrong — a retrieval-quality
   signal (not a substitute for the demand pointer below).
9. For every wish that ended with **no skill installed** — search came back **empty**, OR you
   **rejected every candidate** — record a demand pointer with `curl` (`/report_demand`).
   `wish` is REQUIRED (the wish string you searched). Build the `sketch` **string** exactly per
   **[demand-sketch.md](demand-sketch.md)** — a `"<query_id>: <minified-json>"` build spec
   (it is a STRING, not an object; the endpoint's `sketch` field is a string):
   ```bash
   # body.json  →  { "tenant":"local",
   #   "wish":"<the description + formulations + flattened sketch you searched>",
   #   "sketch":"<query_id>: {\"purpose\":\"…\",\"inputs\":[…],\"outputs\":[…],\"operations\":[…],\"domain_vocab\":[…],\"section_sketch\":\"…\",\"tags\":[…],\"source\":\"unmatched_wish|all_rejected\"}" }
   curl.exe -s --max-time 20 -X POST "$SKILLFED_ENDPOINT/report_demand" \
     -H "Content-Type: application/json" --data-binary "@body.json"
   ```
   The two reports are **complementary**, not conflated: `report_selection` labels retrieval
   quality (these candidates were shown); `report_demand` captures the capability gap (what was
   actually needed). On **all-rejected** send BOTH; on **empty** send only the demand pointer.

## Don't

- Don't put plan/brief/output text into any wish, keyword, sketch, or payload.
- Don't install without user approval, or re-recommend an already-installed skill.
- Don't author a demand sketch for a wish whose candidate you **accepted** (only on empty or all-rejected).
- Don't send `sketch` as a JSON object or `chosen` as null/empty — both are strings (see step 8–9).
- Don't treat candidates as authoritative — they're recall; you and the user decide.
