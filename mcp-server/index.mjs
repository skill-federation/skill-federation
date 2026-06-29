#!/usr/bin/env node
/**
 * Skill Federation MCP server (Node, stdio) — the Python-free finder backend.
 *
 * Exposes the federation as MCP tools so Claude calls them DIRECTLY: no shelling
 * out to Python, no $SKILLFED_PY, no venv. Distributed via `npx -y skillfed-mcp`,
 * so the only runtime is the Node that Claude Code already ships.
 *
 * Tools (contracts/federation-mcp-tools.md):
 *   find_skills          — lexical-recall search over a wish-list (the only discovery path)
 *   get_skill_bundle     — fetch a confirmed match's bundle for install
 *   report_selection     — per-wish agentic-selection outcome (label flywheel)
 *   emit_demand_pointer   — record a build-spec sketch on a miss (empty OR all-rejected)
 *
 * PRIVACY (Principle IV): only abstracted wishes (description + paraphrased formulations
 * + keywords) and, on a miss, a capability sketch ever cross the boundary. Never the plan/brief/output.
 *
 * Config (env): SKILLFED_ENDPOINT (required), SKILLFED_API_KEY (optional),
 * SKILLFED_TENANT, SKILLFED_TOP_N (3), SKILLFED_K (4).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { federation } from "./federation.mjs";
import { findSkills } from "./findSkills.mjs";

const WISH_SCHEMA = {
  type: "object",
  required: ["name", "description", "keywords"],
  properties: {
    name: { type: "string", description: "short hypothetical skill name" },
    description: {
      type: "string",
      description: "one-line, display-only; abstract, no plan specifics",
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5,
      description:
        "1–5 evidence terms the description omits but the target skill's docs would contain",
    },
    formulations: {
      type: "array",
      items: { type: "string" },
      description:
        "~4 vocabulary-varied paraphrases of the description (the load-bearing recall field)",
    },
  },
};

const TOOLS = [
  {
    name: "find_skills",
    description:
      "Search a federated catalog of vetted agent skills for a privacy-abstracted wish-list. " +
      "Returns up to k recall candidates per wish (the client agent makes the final pick). " +
      "Send only abstracted wishes — never the plan, brief, outputs, or any tenant data.",
    inputSchema: {
      type: "object",
      required: ["wishlist"],
      properties: {
        wishlist: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: WISH_SCHEMA,
          description: "1–10 wishes, each an ideal skill for the task",
        },
      },
    },
  },
  {
    name: "get_skill_bundle",
    description:
      "Fetch a confirmed match's bundle (SKILL.md + any extra files) for local install. " +
      "Surface license/provenance/security_flags before installing.",
    inputSchema: {
      type: "object",
      required: ["skill_id"],
      properties: {
        skill_id: { type: "string" },
      },
    },
  },
  {
    name: "report_selection",
    description:
      "Report one wish's agentic-selection outcome. chosen = the selected skill id, or the literal " +
      "string \"None\" when every candidate was rejected (a retrieval-quality label, complementary to " +
      "a demand pointer — not a substitute for it). rejected = the other shown candidate ids.",
    inputSchema: {
      type: "object",
      required: ["query_id", "chosen"],
      properties: {
        query_id: { type: "string" },
        chosen: {
          type: "string",
          description: "selected skill id, or the literal \"None\" if all candidates were rejected",
        },
        rejected: {
          type: "array",
          items: { type: "string" },
          description: "the other shown candidate ids (hard negatives)",
        },
      },
    },
  },
  {
    name: "emit_demand_pointer",
    description:
      "Record a missing capability on a MISS — a wish that returned zero candidates (empty), OR one " +
      "where you rejected every candidate (the rejection reasoning reveals the gap). Pass the searched " +
      "`wish` string plus a `sketch` STRING built per demand-sketch.md (a single-line JSON of " +
      "purpose/inputs/outputs/operations/domain_vocab/section_sketch, prefixed with the query_id). " +
      "Capability-level abstraction only — never plan/brief/output/data.",
    inputSchema: {
      type: "object",
      required: ["wish", "sketch"],
      properties: {
        wish: {
          type: "string",
          description: "the exact wish string you searched (the traceability anchor; required, non-empty)",
        },
        sketch: {
          type: "string",
          description:
            "condensed build spec per demand-sketch.md: \"<query_id>: <minified-json>\" (a STRING, not an object)",
        },
        query_id: {
          type: "string",
          description: "optional; prepended to sketch as the trace if not already embedded",
        },
        tags: { type: "array", items: { type: "string" } },
        source: { type: "string", default: "unmatched_wish" },
      },
    },
  },
];

function jsonResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(code, detail) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: code, detail }, null, 2) }],
    isError: true,
  };
}

const server = new Server(
  { name: "skillfed-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    switch (name) {
      case "find_skills":
        return jsonResult(await findSkills(args.wishlist ?? args));
      case "get_skill_bundle":
        return jsonResult(await federation.fetch(args.skill_id));
      case "report_selection":
        return jsonResult(
          await federation.reportSelection(args.query_id, args.chosen, args.rejected || [])
        );
      case "emit_demand_pointer":
        return jsonResult(
          await federation.emitDemandPointer(
            args.wish, args.sketch, args.query_id || null, args.tags || [], args.source || "unmatched_wish"
          )
        );
      default:
        return errorResult("UNKNOWN_TOOL", `no such tool: ${name}`);
    }
  } catch (e) {
    return errorResult(e.code || "TOOL_ERROR", `${e.name || "Error"}: ${e.message}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
