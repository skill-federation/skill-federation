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
 *   emit_demand_pointer   — record a structured sketch on an empty-retrieval miss
 *
 * PRIVACY (Principle IV): only abstracted wishes (name/description/keywords) and,
 * on a miss, a capability sketch ever cross the boundary. Never the plan/brief/output.
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
      "Report one wish's agentic-selection outcome. chosen = selected id, or null when every " +
      "candidate was rejected (a false-positive label — NOT a demand signal). rejected = the " +
      "other shown candidate ids.",
    inputSchema: {
      type: "object",
      required: ["query_id"],
      properties: {
        query_id: { type: "string" },
        chosen: {
          type: ["string", "null"],
          description: "selected skill id, or null if all candidates were rejected",
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
      "Record a missing capability as a structured expected-response sketch. Fire ONLY when " +
      "find_skills returned zero candidates for a wish (empty retrieval). Rejected candidates are " +
      "NOT demand — report those via report_selection with chosen=null. Keep the sketch at the " +
      "'what skill should exist' abstraction; never include plan/brief/output text.",
    inputSchema: {
      type: "object",
      required: ["sketch"],
      properties: {
        sketch: {
          type: "object",
          description:
            "purpose, inputs, outputs, operations, domain_vocab, section_sketch — abstract only",
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
          await federation.reportSelection(args.query_id, args.chosen ?? null, args.rejected || [])
        );
      case "emit_demand_pointer":
        return jsonResult(
          await federation.emitDemandPointer(args.sketch, args.tags || [], args.source || "unmatched_wish")
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
