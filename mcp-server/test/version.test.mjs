/**
 * One version, NINE places. A release is only correct if every manifest agrees.
 *
 * Nothing in this repo used to check, and the cost was real: `.claude-plugin/marketplace.json`
 * sat at 0.1.2 through two releases because the runbook listed four manifests and there are
 * five files (`mcp-server/server.json` carries the number twice), and `index.mjs` announced
 * itself as 0.1.0 to every MCP client for three releases running.
 *
 * Each of those fails SILENTLY — the package publishes, the plugin installs, the handshake
 * succeeds, and the wrong number ships. This test is the gate: bump one, bump them all.
 *
 * 2026-08-16: it happened AGAIN, and this test could not see it.
 * `python-installer/src/skillfed/__init__.py` still read `__version__ = "0.1.0"` while
 * everything else moved to 0.2.3 — so PyPI published the right version (pyproject.toml is
 * correct and separate) while `import skillfed; skillfed.__version__` reported 0.1.0. Three
 * releases, same rot, same silence, for the same root cause: it was never a TRACKED string,
 * and a gate only guards what it enumerates.
 * The lesson is not "add this file" — it is that fixing the value without extending the
 * ASSERTION just resets the clock. Any new file that carries the version must be added to
 * `versions()` in the same change that introduces it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

/** label -> the version string that ships from that file */
function versions() {
  const server = json("mcp-server/server.json");
  const marketplace = json(".claude-plugin/marketplace.json");
  const pyproject = /^version\s*=\s*"([^"]+)"/m.exec(read("python-installer/pyproject.toml"));
  assert.ok(pyproject, "no [project] version in python-installer/pyproject.toml");
  // The Python package's RUNTIME version. pyproject.toml decides what PyPI
  // publishes; this decides what `import skillfed; skillfed.__version__`
  // reports, and the two rot apart silently - this file sat at 0.1.0 while
  // three releases shipped, the exact failure this test's header describes
  // for index.mjs, surviving only because it was never a tracked string.
  const pyinit = /^__version__\s*=\s*"([^"]+)"/m.exec(
    read("python-installer/src/skillfed/__init__.py")
  );
  assert.ok(pyinit, "no __version__ in python-installer/src/skillfed/__init__.py");
  // the MCP handshake string, read as TEXT: importing index.mjs starts a stdio server
  const handshake = /name:\s*"skillfed-mcp",\s*version:\s*"([^"]+)"/.exec(read("mcp-server/index.mjs"));
  assert.ok(handshake, "could not find the Server({name, version}) handshake in index.mjs");

  return {
    "installer/package.json": json("installer/package.json").version,
    "mcp-server/package.json": json("mcp-server/package.json").version,
    "mcp-server/server.json (version)": server.version,
    "mcp-server/server.json (packages[0].version)": server.packages[0].version,
    "mcp-server/index.mjs (MCP handshake)": handshake[1],
    "integrations/claude-code/.claude-plugin/plugin.json":
      json("integrations/claude-code/.claude-plugin/plugin.json").version,
    ".claude-plugin/marketplace.json": marketplace.plugins[0].version,
    "python-installer/pyproject.toml": pyproject[1],
    "python-installer/src/skillfed/__init__.py (__version__)": pyinit[1],
  };
}

test("every shipped manifest carries the same version", () => {
  const all = versions();
  const distinct = [...new Set(Object.values(all))];
  assert.equal(
    distinct.length,
    1,
    `version drift across manifests:\n${Object.entries(all)
      .map(([k, v]) => `  ${v}  ${k}`)
      .join("\n")}`
  );
});

test("the version is a plain semver triple", () => {
  const [v] = [...new Set(Object.values(versions()))];
  assert.match(v, /^\d+\.\d+\.\d+$/, "the tag is v<version>; keep it a plain triple");
});

test("the MCP registry manifest matches the npm package it validates against", () => {
  // The registry validates server.json against the PUBLISHED npm package and rejects a
  // mismatch, so this pair is the one that fails loudly — but only after the npm publish.
  const server = json("mcp-server/server.json");
  const pkg = json("mcp-server/package.json");
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.equal(server.version, pkg.version);
  assert.equal(pkg.mcpName, server.name, "mcpName proves ownership; it must match server.json");
});
