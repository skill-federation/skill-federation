"""Shared Skill Federation client (forked from qurini/skill-federation).

Abstracts WHERE the Federation Core lives so the same code works against:
  - a LOCAL federation (our MVP core, once built) — imports core directly
  - a HOSTED federation (qurini's keyless demo today) — HTTPS to the API

The integration code (hook, helper, skill) only talks to this client, so swapping
the hosted demo for our own federation core is a config change, not a rewrite —
this is the seam the alignment work preserves.

ADAPTER NOTE (qurini endpoints ↔ our five MCP tools, contracts/federation-mcp-tools.md):
  /search          ↔ find_skills        (qurini is per-wish; batching is emulated
                                          in search_wishlist.py — one async call/wish)
  /fetch           ↔ get_skill_bundle   (carries `purpose`: hint = read, install = write)
  /report_selection↔ report_selection   (per-wish outcome map {skill_id: [Install|Read|Reject,
                                          why]}, dual-written with the legacy chosen/rejected)
  /report_demand   ↔ emit_demand_pointer (carries the structured sketch)
  (no analogue)    ↔ submit_suggestion   (reflection loop — out of this first pass)

PRIVACY (constitution Principle IV): callers MUST send only abstracted wishes
(description + paraphrased formulations + keywords + the structured capability sketch,
which now rides inside the `wish` query string on every search) and, on a miss, that same
sketch as the demand pointer — never the user's plan, brief, output, or any tenant data.
Every field stays at the "what skill should exist" abstraction (the wish floor).

Config (env):
  SKILLFED_ENDPOINT   if set, use the hosted API at this URL; else local core
  SKILLFED_API_KEY    bearer token (OPTIONAL — qurini's demo is keyless)
  SKILLFED_DATA       local index dir (default ../demo/demo_data)
  SKILLFED_TENANT     tenant id (default from $USER/$USERNAME or 'local')
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ENDPOINT = os.environ.get("SKILLFED_ENDPOINT", "").rstrip("/")
API_KEY = os.environ.get("SKILLFED_API_KEY", "")
TENANT = (os.environ.get("SKILLFED_TENANT")
          or os.environ.get("USER") or os.environ.get("USERNAME") or "local")

OUTCOMES = ("Install", "Read", "Reject")

# Near-misses we can still READ, for the legacy projection only (mirrors the table in
# mcp-server/federation.mjs). The map keeps whatever word the agent used; this only decides
# whether that word meant "used it" or "dismissed it", so "Used"/"read it"/"Consulted" cannot
# collapse into chosen="None" — which would record the exact opposite of what happened.
_OUTCOME_SYNONYMS = (
    (("install", "adopt", "save", "kept", "keep"), "Install"),
    (("read", "use", "used", "useful", "consult", "referenc", "applied", "help", "hit"), "Read"),
    (("reject", "dismiss", "discard", "skip", "ignor", "irrelevant", "unused", "not used",
      "no", "none"), "Reject"),
)


def _outcome_kind(label):
    """What an outcome LABEL means for the legacy pair — Install|Read|Reject, or None."""
    s = str(label or "").strip().lower()
    if not s:
        return None
    for canon in OUTCOMES:
        if s == canon.lower():
            return canon
    for prefixes, kind in _OUTCOME_SYNONYMS:
        if s.startswith(prefixes):
            return kind
    return None


def _norm_outcomes(raw) -> dict:
    """Coerce the reported map into {skill_id: [outcome, why]}; {} when it is not one.

    A JSON *string* is parsed before giving up: serializing this field as a string is an
    expected mistake, because the sibling `sketch` field genuinely IS a string. An
    unrecognized outcome WORD is kept verbatim — it is still a label worth recording.
    """
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for k, v in raw.items():
        key = str(k).strip()
        if not key:
            continue
        pair = list(v) if isinstance(v, (list, tuple)) else [v]
        head = str(pair[0]).strip() if pair and pair[0] is not None else ""
        outcome = next((c for c in OUTCOMES if head.lower() == c.lower()), head)
        if not outcome:
            continue
        why = pair[1] if len(pair) > 1 and pair[1] is not None else ""
        out[key] = [outcome, str(why).strip()]
    return out


def _derive_legacy(omap: dict):
    """Legacy chosen/rejected from the outcome map, or None when it cannot be projected.

    None is deliberately DISTINCT from chosen="None": the latter asserts that every candidate
    was genuinely rejected. "None" is emitted only when every label read as a Reject.
    """
    kinds = [(sid, _outcome_kind(val[0])) for sid, val in omap.items()]
    if not kinds:
        return None
    rejected = [sid for sid, k in kinds if k == "Reject"]
    for want in ("Install", "Read"):
        for sid, k in kinds:
            if k == want:
                return {"chosen": sid, "rejected": rejected}
    if all(k == "Reject" for _, k in kinds):
        return {"chosen": "None", "rejected": rejected}
    return None


class SkillfedClient:
    def __init__(self):
        self.endpoint = ENDPOINT
        self._local = None

    # ── local backend (current state) ──
    def _local_fed(self):
        if self._local is None:
            sys.path.insert(0, ROOT)
            from core.federation import Federation  # noqa
            data = os.environ.get("SKILLFED_DATA",
                                  os.path.join(ROOT, "demo", "demo_data"))
            self._local = Federation(data,
                                     bodies_path=os.path.join(ROOT, "corpus",
                                                              "catalog_curated.jsonl"))
            _ = self._local.index
        return self._local

    # ── hosted backend (release) ──
    def _http(self, path: str, payload: dict) -> dict:
        import urllib.request
        headers = {"Content-Type": "application/json"}
        if API_KEY:  # qurini's demo is keyless — only send auth when configured
            headers["Authorization"] = f"Bearer {API_KEY}"
        req = urllib.request.Request(
            f"{self.endpoint}{path}",
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())

    # ── public API (same shape regardless of backend) ──
    # Callers normally pass an explicit, clamped top_n (search_wishlist.py owns the resolution
    # order); this default only matters to direct callers and tracks the same D5 value as
    # mcp-server/. The remote 422s the WHOLE search outside 1–25 — never send 0 or 50.
    def search(self, wish: str, keywords=None, top_n: int = 10) -> dict:
        if self.endpoint:
            return self._http("/search", {"tenant": TENANT, "wish": wish,
                                          "keywords": keywords or [], "top_n": top_n})
        return self._local_fed().search(TENANT, wish, keywords=keywords, top_n=top_n)

    def fetch(self, skill_id: str, purpose: str = "hint") -> dict:
        """Fetch a skill body. `purpose` is "hint" (read it in context — the default, and what
        writes nothing) or "install" (the user has approved writing it to disk). The endpoint
        ignores unknown fields today (verified 2026-07-31: purpose → 200), so intent is
        recorded client-side before the service learns to store it."""
        if self.endpoint:
            return self._http("/fetch", {"tenant": TENANT, "skill_id": skill_id,
                                         "purpose": purpose})
        return self._local_fed().fetch(TENANT, skill_id)

    def report_selection(self, query_id, chosen=None, rejected=None, outcomes=None) -> dict:
        """Label-flywheel report for ONE wish, DUAL-WRITTEN (mirrors mcp-server/federation.mjs).

        The truth is `outcomes`: every shown candidate mapped to
        ``{skill_id: [Install|Read|Reject, "<why>"]}``. **A Read is a hit** — the old
        single-`chosen` shape could not say so. The endpoint still REQUIRES a non-empty
        `chosen` (422 without it) and ignores unknown fields, so both are sent: the legacy
        pair is derived from the map unless passed explicitly.

        FAIL CLOSED: if the map cannot be read and no explicit `chosen` overrides it, raise
        rather than send chosen="None" — that sentinel means "every candidate was genuinely
        rejected", and recording it for an unreadable map poisons the flywheel with a hard
        negative for a wish the catalog may have answered. Reporting is advisory: callers
        catch this and carry on; a failed report is never a task error.
        """
        omap = _norm_outcomes(outcomes)
        legacy = _derive_legacy(omap)
        override = chosen if (chosen and str(chosen).strip()) else None
        if not override and not legacy:
            raise ValueError(
                'report_selection needs a readable outcomes map '
                '{"<skill_id>": ["Install"|"Read"|"Reject", "<why>"]} or an explicit chosen'
            )
        payload = {"tenant": TENANT, "query_id": query_id,
                   "chosen": override or legacy["chosen"],
                   "rejected": rejected if rejected is not None
                   else (legacy["rejected"] if legacy else [])}
        if omap:
            payload["outcomes"] = omap
        if self.endpoint:
            return self._http("/report_selection", payload)
        return self._local_fed().report_selection(TENANT, query_id, payload["chosen"],
                                                  payload["rejected"])

    def report_outcome(self, skill_id, outcome) -> dict:
        if self.endpoint:
            return self._http("/report_outcome", {"tenant": TENANT,
                              "skill_id": skill_id, "outcome": outcome})
        return self._local_fed().report_outcome(TENANT, skill_id, outcome)

    def report_demand(self, wish, sketch=None) -> dict:
        """Record demand for a missing skill. `wish` is REQUIRED (the searched wish
        string — the endpoint rejects an empty wish); `sketch` is an optional STRING
        (the condensed build spec, see demand-sketch.md). Never a raw object."""
        if not (wish and str(wish).strip()):
            raise ValueError("report_demand requires a non-empty wish string")
        if self.endpoint:
            return self._http("/report_demand", {"tenant": TENANT, "wish": wish,
                              "sketch": sketch})
        return self._local_fed().report_demand(TENANT, wish, sketch)

    def emit_demand_pointer(self, wish, sketch, query_id=None, tags=None,
                            source: str = "unmatched_wish") -> dict:
        """Record a demand pointer on a MISS — an empty retrieval OR after rejecting
        every candidate (see demand-sketch.md).

        `wish`  = the searched wish string (required; traceability anchor).
        `sketch`= the build spec: either a dict of the canonical fields (purpose,
                  inputs, outputs, operations, domain_vocab, section_sketch) or a
                  ready string. A dict is serialized to a single-line JSON string,
                  merged with tags/source, then prefixed with "<query_id>: ". The
                  endpoint's `sketch` field is a STRING, so we never send an object.

        Stays at "what skill should exist" abstraction — never the raw plan/brief
        (Principle IV). Carried over qurini's /report_demand.
        """
        if isinstance(sketch, dict):
            obj = dict(sketch)
            obj.setdefault("tags", tags or [])
            obj.setdefault("source", source)
            sketch_str = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
        else:
            sketch_str = str(sketch)
        if query_id:
            sketch_str = f"{query_id}: {sketch_str}"
        return self.report_demand(wish=wish, sketch=sketch_str)
