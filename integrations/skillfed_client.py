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
  /fetch           ↔ get_skill_bundle
  /report_selection↔ report_selection   (per-wish here: chosen + rejected ids)
  /report_demand   ↔ emit_demand_pointer (carries the structured sketch)
  (no analogue)    ↔ submit_suggestion   (reflection loop — out of this first pass)

PRIVACY (constitution Principle IV): callers MUST send only abstracted wishes
(description + paraphrased formulations + keywords) and, on a miss, a capability sketch
— never the user's plan, brief, output, or any tenant data.

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
    def search(self, wish: str, keywords=None, top_n: int = 6) -> dict:
        if self.endpoint:
            return self._http("/search", {"tenant": TENANT, "wish": wish,
                                          "keywords": keywords or [], "top_n": top_n})
        return self._local_fed().search(TENANT, wish, keywords=keywords, top_n=top_n)

    def fetch(self, skill_id: str) -> dict:
        if self.endpoint:
            return self._http("/fetch", {"tenant": TENANT, "skill_id": skill_id})
        return self._local_fed().fetch(TENANT, skill_id)
    def report_selection(self, query_id, chosen, rejected=None) -> dict:
        """Label-flywheel report for ONE wish's agentic selection (spec tool 5).

        chosen = selected_id (or None = all-rejected → false-positive label);
        rejected = the other shown candidate ids (hard negatives). Per-wish here
        because the qurini adapter issues one /search (one query_id) per wish.
        """
        if self.endpoint:
            return self._http("/report_selection", {"tenant": TENANT,
                              "query_id": query_id, "chosen": chosen,
                              "rejected": rejected or []})
        return self._local_fed().report_selection(TENANT, query_id, chosen, rejected)

    def report_outcome(self, skill_id, outcome) -> dict:
        if self.endpoint:
            return self._http("/report_outcome", {"tenant": TENANT,
                              "skill_id": skill_id, "outcome": outcome})
        return self._local_fed().report_outcome(TENANT, skill_id, outcome)

    def report_demand(self, wish, sketch=None) -> dict:
        if self.endpoint:
            return self._http("/report_demand", {"tenant": TENANT, "wish": wish,
                              "sketch": sketch})
        return self._local_fed().report_demand(TENANT, wish, sketch)

    def emit_demand_pointer(self, sketch: dict, tags=None,
                            source: str = "unmatched_wish") -> dict:
        """Spec tool 4 — record a structured expected-response sketch on a MISS.

        Fires ONLY when find_skills returned zero candidates for a wish (empty
        retrieval). Agent-rejected candidate sets are NOT demand — they are
        false-positive labels via report_selection(selected_id=None). The two
        streams must never be conflated (data-model.md Demand Pointer).

        `sketch` stays at "what skill should exist" abstraction — never the raw
        plan/brief (Principle IV). Adapter: carried over qurini's /report_demand.
        """
        payload_sketch = dict(sketch or {})
        payload_sketch.setdefault("tags", tags or [])
        payload_sketch.setdefault("source", source)
        return self.report_demand(wish=None, sketch=payload_sketch)
