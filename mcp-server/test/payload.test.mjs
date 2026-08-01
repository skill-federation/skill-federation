/**
 * Packaging: what actually ships.
 *
 * Three separate whitelists decide whether a file reaches a user — scripts/vendor-payload.mjs
 * FILES (curl + installer payload), installer/package.json files[] (npm), and
 * mcp-server/package.json files[] (npm). Each fails silently: nothing in-repo breaks, CI is
 * green, and the published artifact is missing a file. Two live bugs came from exactly this —
 * a SKILL.md shipped with a dead [demand-sketch.md] link, and an MCP server published without
 * the module its entrypoint imports.
 *
 * Also the drift guard: skills/ is generated from integrations/claude-code/skills/ and is
 * asserted byte-for-byte here WITHOUT running the generator, so a stale mirror fails locally
 * before it fails in CI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CANON_SKILLS = path.join(ROOT, "integrations", "claude-code", "skills");
const MIRROR_SKILLS = path.join(ROOT, "skills");
const VENDOR_SCRIPT = path.join(ROOT, "scripts", "vendor-payload.mjs");

const read = (p) => fs.readFileSync(p, "utf8");

/**
 * Relative markdown link targets, ignoring code. `**[name](link)**` inside a backticked
 * span is documentation ABOUT markdown, not a link — counting it would make this test
 * unpassable for any file that documents a link format.
 */
function relativeLinks(markdown) {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, "") // fenced blocks
    .replace(/`[^`\n]*`/g, ""); // inline spans (single-line by definition)
  return [...prose.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
    .map((m) => m[1].split("#")[0])
    .filter((t) => t && !/^(https?:|mailto:|#|\/)/.test(t));
}

const listFiles = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
const listDirs = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

/**
 * The FILES table, parsed out of the generator's SOURCE — importing it would run it, and a
 * test that writes the thing it is checking proves nothing. Each entry is
 * [<canonical path expression>, '<vendored filename>'].
 */
function vendorFiles() {
  const src = read(VENDOR_SCRIPT);
  const block = /const FILES = \[([\s\S]*?)\n\]/.exec(src);
  assert.ok(block, "could not find the FILES array in vendor-payload.mjs");
  const entries = [...block[1].matchAll(/\[\s*([^[\]]+?),\s*'([^']+)'\s*\]/g)].map((m) => ({
    expr: m[1].trim(),
    name: m[2],
  }));
  assert.ok(entries.length >= 3, `parsed only ${entries.length} FILES entries — regex is stale`);
  return entries;
}

/** Resolve a FILES source expression (join(SRC, 'hooks', 'x')) to a real path. */
function resolveExpr(expr) {
  const BASES = {
    SRC: path.join(ROOT, "integrations", "claude-code"),
    SRC_SKILLS: CANON_SKILLS,
    FINDER: path.join(CANON_SKILLS, "skill-federation"),
    CANONICAL_SKILL: path.join(CANON_SKILLS, "skill-federation", "SKILL.md"),
    ROOT_SKILLS: MIRROR_SKILLS,
    ROOT,
  };
  if (expr in BASES) return BASES[expr];
  const m = /^join\(\s*([A-Z_]+)\s*,\s*(.+)\)$/.exec(expr);
  assert.ok(m, `unrecognized FILES path expression: ${expr}`);
  const base = BASES[m[1]];
  assert.ok(base, `unknown base identifier ${m[1]} in ${expr}`);
  const segs = [...m[2].matchAll(/'([^']+)'/g)].map((s) => s[1]);
  return path.join(base, ...segs);
}

test("every FILES entry points at a canonical file that exists", () => {
  for (const { expr, name } of vendorFiles()) {
    const src = resolveExpr(expr);
    assert.ok(fs.existsSync(src), `FILES names a missing source: ${src}`);
    assert.equal(path.basename(src), name, `vendored name should match the source basename`);
  }
});

test("the payload carries all six files the installers drop", () => {
  const names = vendorFiles().map((f) => f.name).sort();
  assert.deepEqual(names, [
    "SKILL.md",
    "demand-sketch.md",
    "plan_nudge.json",
    "plan_start_nudge.json",
    "skillfed.md",
    "start_nudge.sh",
  ]);
});

test("every relative link in a vendored .md is itself vendored", () => {
  // The bug class: SKILL.md links [demand-sketch.md](demand-sketch.md), the file was not in
  // FILES, and every curl-tier install shipped a dead link. Nothing else would have caught it.
  const files = vendorFiles();
  const shipped = new Set(files.map((f) => f.name));
  let linksChecked = 0;

  for (const { expr, name } of files) {
    if (!name.endsWith(".md")) continue;
    const src = resolveExpr(expr);
    for (const bare of relativeLinks(read(src))) {
      assert.ok(
        shipped.has(bare),
        `${name} links to ${bare}, which is not in vendor-payload.mjs FILES — ` +
          `the shipped payload is flat, so the link would 404 for every curl-tier install`
      );
      assert.ok(
        fs.existsSync(path.join(path.dirname(src), bare)),
        `${name} links to ${bare}, which does not exist next to it`
      );
      linksChecked++;
    }
  }
  assert.ok(linksChecked > 0, "found no relative links to check — the regex is probably stale");
});

test("installer/package.json ships every payload file (files[] is a whitelist)", () => {
  const pkg = JSON.parse(read(path.join(ROOT, "installer", "package.json")));
  for (const { name } of vendorFiles()) {
    assert.ok(
      pkg.files.includes(`payload/${name}`),
      `installer/package.json files[] omits payload/${name} — npm would not publish it`
    );
  }
});

test("python-installer force-includes the whole payload dir", () => {
  // hatchling is VCS-aware and the payload is git-ignored, so without `artifacts` the wheel
  // ships no payload at all. A glob, unlike npm's list, needs no per-file maintenance.
  const toml = read(path.join(ROOT, "python-installer", "pyproject.toml"));
  assert.match(toml, /artifacts\s*=\s*\[\s*"src\/skillfed\/payload\/\*"\s*\]/);
});

test("mcp-server/package.json ships every module the server imports", () => {
  const dir = path.join(ROOT, "mcp-server");
  const pkg = JSON.parse(read(path.join(dir, "package.json")));
  const modules = listFiles(dir).filter((f) => f.endsWith(".mjs"));
  for (const m of modules) {
    assert.ok(
      pkg.files.includes(m),
      `mcp-server/package.json files[] omits ${m} — the published server would ` +
        `die at startup on ERR_MODULE_NOT_FOUND, and nothing in this repo would fail`
    );
  }
  assert.ok(pkg.files.includes(path.basename(pkg.main)), "main is not in files[]");
});

test("skills/ is byte-identical to the canonical source", () => {
  const canonical = listDirs(CANON_SKILLS);
  assert.deepEqual(listDirs(MIRROR_SKILLS), canonical, "mirrored skill folders differ");

  for (const skill of canonical) {
    const from = path.join(CANON_SKILLS, skill);
    const to = path.join(MIRROR_SKILLS, skill);
    assert.deepEqual(
      listFiles(to),
      listFiles(from),
      `skills/${skill}/ has a different file set — run: node scripts/vendor-payload.mjs`
    );
    for (const f of listFiles(from)) {
      assert.ok(
        fs.readFileSync(path.join(from, f)).equals(fs.readFileSync(path.join(to, f))),
        `skills/${skill}/${f} drifted from canonical — run: node scripts/vendor-payload.mjs`
      );
    }
  }
});

test("the mirror is a whole-folder copy, so its relative links resolve too", () => {
  for (const skill of listDirs(MIRROR_SKILLS)) {
    const dir = path.join(MIRROR_SKILLS, skill);
    for (const f of listFiles(dir).filter((n) => n.endsWith(".md"))) {
      for (const target of relativeLinks(read(path.join(dir, f)))) {
        assert.ok(
          fs.existsSync(path.join(dir, target)),
          `skills/${skill}/${f} links to ${target}, which is not in the mirror`
        );
      }
    }
  }
});
