/**
 * Tool-schema sanity.
 *
 * These schemas are the contract an MCP client validates calls against, and a `required`
 * entry with no matching property makes a tool uncallable — the client rejects every call
 * before it reaches us. Structural assertions only: the descriptions are prompt copy and are
 * expected to be rewritten often, so nothing here asserts their wording.
 *
 * tools.mjs is dependency-free on purpose (index.mjs opens a stdio transport at import time
 * and needs the SDK), which is what lets this run in a clean checkout with no npm install.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SKILLFED_ENDPOINT = "";

const { TOOLS, WISH_SCHEMA, PACKAGE_WISH_SCHEMA } = await import("../tools.mjs");
const { clampTopN, REMOTE_TOP_N_MIN, REMOTE_TOP_N_MAX } = await import("../findSkills.mjs");
const { clampLimit, LIMIT_MIN, LIMIT_MAX } = await import("../findPackages.mjs");

const byName = new Map(TOOLS.map((t) => [t.name, t]));
const tool = (n) => {
  const t = byName.get(n);
  assert.ok(t, `no such tool: ${n}`);
  return t;
};

/** Every `required` entry must be a declared property — recursively. */
function requiredIsDeclared(schema, where) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.required)) {
    const props = Object.keys(schema.properties || {});
    for (const r of schema.required) {
      assert.ok(
        props.includes(r),
        `${where}: required "${r}" is not in properties [${props.join(", ")}]`
      );
    }
  }
  for (const [k, v] of Object.entries(schema.properties || {})) {
    requiredIsDeclared(v, `${where}.${k}`);
  }
  if (schema.items) requiredIsDeclared(schema.items, `${where}[]`);
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    requiredIsDeclared(schema.additionalProperties, `${where}.*`);
  }
}

test("the five federation tools are exported", () => {
  assert.deepEqual(
    TOOLS.map((t) => t.name).sort(),
    ["emit_demand_pointer", "find_packages", "find_skills", "get_skill_bundle", "report_selection"]
  );
});

test("every tool is structurally well formed", () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.name, "string");
    assert.ok(t.name.length > 0);
    assert.equal(typeof t.description, "string");
    assert.ok(t.description.trim().length > 0, `${t.name}: empty description`);
    assert.equal(t.inputSchema?.type, "object", `${t.name}: inputSchema must be an object`);
    assert.ok(t.inputSchema.properties, `${t.name}: no properties`);
    requiredIsDeclared(t.inputSchema, t.name);
  }
});

test("every required entry exists in properties, including the wish schema", () => {
  requiredIsDeclared(WISH_SCHEMA, "WISH_SCHEMA");
  assert.deepEqual(WISH_SCHEMA.required, ["name", "description", "keywords"]);
  assert.equal(WISH_SCHEMA.properties.keywords.minItems, 1);
  assert.equal(WISH_SCHEMA.properties.keywords.maxItems, 5);
});

test("find_skills: wishlist bounds match the validator (1–10)", () => {
  const wishlist = tool("find_skills").inputSchema.properties.wishlist;
  assert.equal(wishlist.type, "array");
  assert.equal(wishlist.minItems, 1);
  assert.equal(wishlist.maxItems, 10);
  assert.equal(wishlist.items, WISH_SCHEMA, "the schema must reuse WISH_SCHEMA, not a copy");
});

test("find_skills: top_n bounds mirror the clamp that actually enforces them", () => {
  const topN = tool("find_skills").inputSchema.properties.top_n;
  assert.ok(topN, "find_skills has no top_n");
  assert.equal(topN.type, "integer");
  assert.equal(topN.minimum, REMOTE_TOP_N_MIN);
  assert.equal(topN.maximum, REMOTE_TOP_N_MAX);
  // clampTopN(NaN) is the fallback the resolution order ends at — the advertised default
  // must be the same number, or a client that omits top_n gets something else.
  assert.equal(topN.default, clampTopN(NaN));
  assert.equal(topN.default, 10);
  assert.equal("wishlist" in tool("find_skills").inputSchema.properties, true);
  assert.deepEqual(tool("find_skills").inputSchema.required, ["wishlist"]);
});

test("find_packages: wish schema requires only description", () => {
  requiredIsDeclared(PACKAGE_WISH_SCHEMA, "PACKAGE_WISH_SCHEMA");
  assert.deepEqual(PACKAGE_WISH_SCHEMA.required, ["description"]);
  assert.equal(PACKAGE_WISH_SCHEMA.properties.keywords.maxItems, 5);
  assert.equal(
    PACKAGE_WISH_SCHEMA.properties.keywords.minItems,
    undefined,
    "keywords are optional for a package wish, unlike find_skills'"
  );
});

test("find_packages: wishlist bounds match the validator (1–10)", () => {
  const wishlist = tool("find_packages").inputSchema.properties.wishlist;
  assert.equal(wishlist.type, "array");
  assert.equal(wishlist.minItems, 1);
  assert.equal(wishlist.maxItems, 10);
  assert.equal(
    wishlist.items,
    PACKAGE_WISH_SCHEMA,
    "the schema must reuse PACKAGE_WISH_SCHEMA, not a copy"
  );
  assert.deepEqual(tool("find_packages").inputSchema.required, ["wishlist"]);
});

test("find_packages: limit bounds mirror the clamp that actually enforces them", () => {
  const limit = tool("find_packages").inputSchema.properties.limit;
  assert.ok(limit, "find_packages has no limit");
  assert.equal(limit.type, "integer");
  assert.equal(limit.minimum, LIMIT_MIN);
  assert.equal(limit.maximum, LIMIT_MAX);
  assert.equal(LIMIT_MIN, REMOTE_TOP_N_MIN, "bounds happen to match find_skills' top_n");
  assert.equal(LIMIT_MAX, REMOTE_TOP_N_MAX);
  // clampLimit(NaN) is the fallback the resolution order ends at — the advertised default
  // must be the same number, or a client that omits limit gets something else.
  assert.equal(limit.default, clampLimit(NaN));
  assert.equal(limit.default, 10);
});

test("get_skill_bundle: purpose is a two-value enum defaulting to the read path", () => {
  const props = tool("get_skill_bundle").inputSchema.properties;
  assert.deepEqual(tool("get_skill_bundle").inputSchema.required, ["skill_id"]);
  assert.equal(props.skill_id.type, "string");
  assert.ok(props.purpose, "get_skill_bundle has no purpose");
  assert.equal(props.purpose.type, "string");
  assert.deepEqual(props.purpose.enum, ["hint", "install"]);
  assert.equal(props.purpose.default, "hint", "the default must be the one that writes nothing");
  assert.equal(props.purpose.enum.includes(props.purpose.default), true);
});

test("report_selection: outcomes is required and legacy fields stay optional", () => {
  const schema = tool("report_selection").inputSchema;
  assert.deepEqual(schema.required.sort(), ["outcomes", "query_id"]);
  assert.equal(schema.properties.outcomes.type, "object");
  const pair = schema.properties.outcomes.additionalProperties;
  assert.equal(pair.type, "array", "each outcome is [outcome, reasoning]");
  assert.equal(pair.maxItems, 2);
  // The endpoint still requires `chosen`; the client derives it, so the tool must not.
  assert.equal(schema.required.includes("chosen"), false);
  assert.ok(schema.properties.chosen, "chosen must remain available as an override");
  assert.ok(schema.properties.rejected);
});

test("emit_demand_pointer: sketch crosses as a STRING, not an object", () => {
  const schema = tool("emit_demand_pointer").inputSchema;
  assert.deepEqual(schema.required.sort(), ["sketch", "wish"]);
  assert.equal(schema.properties.wish.type, "string");
  assert.equal(schema.properties.sketch.type, "string", "the endpoint's sketch field is a string");
});

test("no schema advertises a default outside its own constraints", () => {
  for (const t of TOOLS) {
    for (const [name, p] of Object.entries(t.inputSchema.properties)) {
      if (p.default === undefined) continue;
      const where = `${t.name}.${name}`;
      if (p.enum) assert.ok(p.enum.includes(p.default), `${where}: default not in enum`);
      if (p.minimum !== undefined) assert.ok(p.default >= p.minimum, `${where}: default < minimum`);
      if (p.maximum !== undefined) assert.ok(p.default <= p.maximum, `${where}: default > maximum`);
      if (p.type === "integer") assert.ok(Number.isInteger(p.default), `${where}: non-integer default`);
      if (p.type === "string") assert.equal(typeof p.default, "string", `${where}: non-string default`);
    }
  }
});
