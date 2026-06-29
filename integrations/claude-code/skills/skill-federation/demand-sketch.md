# Authoring a demand sketch (canonical format — do not diverge)

A **demand sketch** is what the finder records when a wish ends with **no skill installed** — the
build spec for the missing skill. It must be **privacy-safe** (capability-level only) yet
**detailed enough that the federation can later auto-build the skill** from it. This file is the
single source of truth; SKILL.md, `/skillfed`, the MCP `emit_demand_pointer` tool, and the
plan-approval hook all defer to it so every session/agent emits the same shape.

## When to author one
- **Empty retrieval** — the wish's `/search` returned **zero candidates**. The gap is the wish itself.
- **All-rejected** — candidates came back but **none fit**. Your *reasoning about why none fit* is
  the richest input; that is when the true gap becomes obvious. Author the sketch from that reasoning.

Do **not** author a sketch for a wish whose candidate you accepted.

## Where it goes
Send it on `/report_demand` (curl), `SkillfedClient().report_demand(...)` (Python), or the
`emit_demand_pointer` MCP tool (Node):
- **`wish`** — the exact wish string you searched (`description` + `formulations`). REQUIRED,
  non-empty. This is the traceability anchor and what the endpoint requires.
- **`sketch`** — a STRING shaped as `"<query_id>: <minified-json>"` (see below).

## The sketch string (exact)
`"<query_id>: "` followed by a **single-line minified JSON object** with these fields:

| field | type | meaning |
|---|---|---|
| `purpose` | string | one line — what the missing skill should do |
| `inputs` | string[] | the kinds of input it consumes (abstract) |
| `outputs` | string[] | the kinds of output it produces (abstract) |
| `operations` | string[] | the key steps / transformations it performs |
| `domain_vocab` | string[] | discriminative domain terms its docs would contain |
| `section_sketch` | string | terse outline of the skill (`·`-separated); optional |
| `tags` | string[] | a few category tags |
| `source` | string | `"unmatched_wish"` (empty) or `"all_rejected"` (you rejected all) |

Keep the whole `sketch` string **≤ ~600 chars**; use short phrases. The endpoint's `sketch` field
is a **string**, so the JSON is serialized into it — never send a raw object.

### Example
```
wish   = "draft a go-to-market strategy section for a dataroom from an ICP and channel hypotheses ..."
sketch = "q_8f2c91: {\"purpose\":\"Draft a GTM strategy section for a B2B SaaS dataroom from an ICP and channel hypotheses\",\"inputs\":[\"ideal-customer-profile\",\"channel hypotheses\"],\"outputs\":[\"dataroom GTM section\"],\"operations\":[\"segment ICP\",\"map channels to motion\",\"draft narrative\"],\"domain_vocab\":[\"go-to-market\",\"sales motion\",\"ICP\",\"channel mix\",\"PLG\"],\"section_sketch\":\"Overview · ICP · Channels · Motion · Metrics\",\"tags\":[\"gtm\",\"dataroom\",\"b2b-saas\"],\"source\":\"all_rejected\"}"
```

## Privacy floor (non-negotiable)
Every field stays at the **"what skill should exist"** abstraction — the same floor as a wish.
NEVER include the user's plan, brief, file contents, outputs, data values, file names, or any
tenant content. Describe the *capability*, never the task. If you can't phrase a field without
quoting the user's content, abstract it until you can.

## Don't
- Don't author a demand sketch for a wish whose candidate you accepted.
- Don't put real data, file paths, or task specifics into any field.
- Don't send `sketch` as a JSON object — it must be a STRING.
- Don't omit the `"<query_id>: "` prefix — it is the trace back to the search.
