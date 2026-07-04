# Authoring a sketch (canonical format — do not diverge)

A **sketch** is the finder's structured expected-response hypothesis (SIRA step i): a compact spec
of the ideal skill for a wish. **Author one per wish, up front** — it does double duty:

1. **Search-time:** its flattened term values are appended to the wish query, so the single BM25
   call sees the full discriminative vocabulary a matching SKILL.md would contain (SIRA step iii;
   SKILL.md Hop 1). This is the `sketch` field on every wish.
2. **Miss-time (demand pointer):** when a wish ends with **no skill installed**, the *same* sketch
   is sent unchanged as the build spec for the missing skill — no re-derivation.

It must be **privacy-safe** (capability-level only) yet **detailed enough that the federation can
later auto-build the skill** from it. This file is the single source of truth; SKILL.md,
`/skillfed`, the MCP `find_skills`/`emit_demand_pointer` tools, and the plan-approval hook all defer
to it so every session/agent emits the same shape.

## When to author / when to send
**Author a sketch for every wish, up front** (it rides in the search query). What changes by
outcome is whether you **send it as a demand pointer**:
- **Empty retrieval** — the wish's `/search` returned **zero candidates**. The gap is the wish
  itself: send the sketch on `/report_demand` (`source: "unmatched_wish"`).
- **All-rejected** — candidates came back but **none fit**. Your *reasoning about why none fit* is
  the richest input; refine the up-front sketch from that reasoning, then send it
  (`source: "all_rejected"`).
- **Accepted a candidate** — do **not** send a demand pointer (the up-front sketch was still used
  for the search; it is simply not a build signal). The hit-path use of the sketch is a precision
  signal collected server-side (skill-search-demand.md Component 4).

## Where it goes
Send it on `/report_demand` (curl), `SkillfedClient().report_demand(...)` (Python), or the
`emit_demand_pointer` MCP tool (Node):
- **`wish`** — the exact wish string you searched (`description` + `formulations` + flattened
  `sketch`). REQUIRED, non-empty. This is the traceability anchor and what the endpoint requires.
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
- Don't send a demand pointer for a wish whose candidate you accepted (still author the sketch
  up front for the search — just don't route it to `/report_demand`).
- Don't put real data, file paths, or task specifics into any field.
- Don't send `sketch` as a JSON object — it must be a STRING.
- Don't omit the `"<query_id>: "` prefix — it is the trace back to the search.
