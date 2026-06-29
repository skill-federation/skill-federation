---
description: Find vetted agent skills for a task via the Skill Federation wish-list finder
---

Run the **Skill Federation wish-list finder** (the `skill-federation` skill) for the
task below. Follow that skill's flow exactly:

1. Privately sketch the ideal skill(s), then write a wish-list of **up to 10 wishes**,
   each `{name, description, keywords, formulations}`: a one-line `description` (display),
   **1–5 evidence keywords**, and **~4 vocabulary-varied paraphrases** in `formulations`
   (the load-bearing recall field). Abstract capability only — **never put the task's raw
   content, data, or outputs into any field** (constitution Principle IV).
2. Search each wish with `curl` (POST `$SKILLFED_ENDPOINT/search`, default endpoint
   `https://qurini-skill-federation.hf.space`): concatenate each wish's
   description+formulations into the `wish` string, send `keywords` and `top_n`. No
   Python, no Node — just `curl` (use `curl.exe` on Windows). Then drop any candidate
   whose name matches a skill already in `~/.claude/skills` or `./.claude/skills`.
3. Per wish, select the best candidate or reject all. Present matches with trust
   metadata (license class, provenance, stars, source, ⚠ flags) and get approval
   **before** installing anything.
4. On approval, fetch with `curl` (POST `/fetch`) + install the returned `body`/`files` under
   `.claude/skills/<id>/` (local-first: use an existing local copy if present). Then report two
   complementary outcomes: for any wish that had candidates → `curl` POST `/report_selection`
   with `chosen` = the picked id, or the literal `"None"` if you rejected all; for any wish with
   **no skill installed** (empty OR all-rejected) → `curl` POST `/report_demand` with the `wish`
   string + a `sketch` string built per `demand-sketch.md`.

If the task below is empty, ask the user what capability they're looking for.

Task to search for: $ARGUMENTS
