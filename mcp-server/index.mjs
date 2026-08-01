#!/usr/bin/env node
/**
 * Skill Federation MCP server (Node, stdio) — the Python-free finder backend.
 *
 * Exposes the federation as MCP tools so Claude calls them DIRECTLY: no shelling
 * out to Python, no $SKILLFED_PY, no venv. Distributed via `npx -y skillfed-mcp`,
 * so the only runtime is the Node that Claude Code already ships.
 *
 * The model these tools implement is CONSULT MANY, INSTALL RARELY: search as often as the
 * work needs, fetch several bodies and read them as field notes on current practice, install
 * only what will be reused — and only with the user's approval. Nothing here writes to disk;
 * the client agent does that, at Hop 3, if it ever gets there.
 *
 * Tools (contracts/federation-mcp-tools.md):
 *   find_skills          — lexical-recall search over a wish-list (the only discovery path)
 *   get_skill_bundle     — fetch a skill's full text to READ (purpose "hint", the default)
 *                          or to install (purpose "install"); the tag is echoed back
 *   report_selection     — per-wish outcome map {skill_id: [Install|Read|Reject, why]},
 *                          dual-written with the legacy chosen/rejected (label flywheel).
 *                          ADVISORY: a failed report is never a task error.
 *   emit_demand_pointer   — record a build-spec sketch on a miss (empty OR all-rejected).
 *                          ADVISORY too — a demand pointer IS a report, and the miss path is
 *                          already the bad day; a flaky endpoint must not also fail the task.
 *
 * PRIVACY (Principle IV): only abstracted wishes (description + paraphrased formulations
 * + keywords) and, on a miss, a capability sketch ever cross the boundary. Never the plan/brief/output.
 *
 * Config (env): SKILLFED_ENDPOINT (required), SKILLFED_API_KEY (optional),
 * SKILLFED_TENANT, SKILLFED_TOP_N (10, clamped to the remote's 1–25), SKILLFED_K (4).
 *
 * Tool SCHEMAS live in tools.mjs — this file connects a stdio transport at the top level,
 * so it can never be imported (by a test or anything else) without starting a server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { federation } from "./federation.mjs";
import { findSkills } from "./findSkills.mjs";
import { TOOLS } from "./tools.mjs";

function jsonResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(code, detail) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: code, detail }, null, 2) }],
    isError: true,
  };
}

/**
 * Reporting feeds the label flywheel; it is never part of the user's task. A 4xx, a dead
 * endpoint or a malformed map must therefore not reach the agent as a tool error — that
 * would derail work over telemetry. Swallow it, note it on stderr (stdout is the MCP
 * transport), and hand back a plain non-error result saying it wasn't recorded.
 */
async function advisory(label, fn) {
  try {
    return { reported: true, ...(await fn()) };
  } catch (e) {
    const note = `${label} not recorded: ${e.name || "Error"}: ${e.message}`;
    console.error(`[skillfed-mcp] ${note}`);
    return { reported: false, note };
  }
}

// Keep `version` equal to mcp-server/package.json — it is what an MCP client displays, and it
// silently rotted from 0.1.0 through three releases. test/version.test.mjs asserts the pair.
const server = new Server(
  { name: "skillfed-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    switch (name) {
      // Pass `args` whole: unwrapping to args.wishlist would drop sibling fields such as
      // top_n. validateWishlist accepts both the bare array and the {wishlist} shape.
      case "find_skills":
        return jsonResult(await findSkills(args));
      case "get_skill_bundle": {
        // Unknown values fall back to "hint" — the reading default writes nothing, so
        // guessing wrong here is harmless in the direction that matters.
        const purpose = args.purpose === "install" ? "install" : "hint";
        const bundle = await federation.fetch(args.skill_id, purpose);
        return jsonResult({ ...bundle, purpose });
      }
      case "report_selection":
        return jsonResult(
          await advisory("selection", () =>
            federation.reportSelection(args.query_id, {
              outcomes: args.outcomes,
              chosen: args.chosen,
              rejected: args.rejected,
            })
          )
        );
      // Advisory for the same reason report_selection is: a demand pointer is bookkeeping, and
      // it fires on the path where the wish ALREADY came back empty. Surfacing a dead endpoint
      // as isError there would turn telemetry into a visible task failure.
      case "emit_demand_pointer":
        return jsonResult(
          await advisory("demand", () =>
            federation.emitDemandPointer(
              args.wish, args.sketch, args.query_id || null, args.tags || [], args.source || "unmatched_wish"
            )
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
