/**
 * Local-skill check — Node port of integrations/local_skills.py.
 *
 * Don't recommend skills the user already has installed. We scan the known
 * Claude Code skill locations, read each SKILL.md's frontmatter `name`, and use
 * those names to filter / demote federation candidates.
 *
 * Scanned locations (Claude Code; v1 scope):
 *   ~/.claude/skills/<skill>/SKILL.md          (global)
 *   <cwd>/.claude/skills/<skill>/SKILL.md       (project)
 *   $CLAUDE_PROJECT_DIR/.claude/skills/...       (Claude Code sets this for MCP servers)
 *
 * Matching is by normalized skill `name` (the spec's unique id within a scope).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mirror local_skills.py: _FM_NAME = ^---\n ... \bname\s*:\s*([^\n]+) ... \n---
const FM_NAME = /^---\s*\n[\s\S]*?\bname\s*:\s*([^\n]+)[\s\S]*?\n---/;
const TOK = /[a-z0-9]+/g;

function normName(s) {
  return (String(s).toLowerCase().match(TOK) || []).join("-");
}

function readName(skillMd) {
  let text;
  try {
    const fd = fs.openSync(skillMd, "r");
    try {
      const buf = Buffer.alloc(4000);
      const n = fs.readSync(fd, buf, 0, 4000, 0);
      text = buf.toString("utf8", 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  const m = FM_NAME.exec(text);
  if (m) return m[1].trim().replace(/^['"]|['"]$/g, "");
  // fallback: parent dir name
  return path.basename(path.dirname(skillMd));
}

function candidateDirs() {
  const home = os.homedir();
  const cwd = process.cwd();
  const proj = process.env.CLAUDE_PROJECT_DIR || cwd;
  const roots = [
    path.join(home, ".claude", "skills"),
    path.join(cwd, ".claude", "skills"),
    path.join(proj, ".claude", "skills"),
  ];
  const seen = new Set();
  const out = [];
  for (const r of roots) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

function listDirs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listMdFiles(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".md"))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Set of normalized names of locally-installed skills. */
export function installedSkillNames(extraDirs = []) {
  const names = new Set();
  const dirs = [...candidateDirs(), ...extraDirs];
  for (const root of dirs) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    // <root>/<skill>/SKILL.md layout
    for (const sub of listDirs(root)) {
      const md = path.join(root, sub, "SKILL.md");
      if (fs.existsSync(md)) {
        const nm = readName(md);
        if (nm) names.add(normName(nm));
      }
    }
    // also bare <root>/<name>.md layout
    for (const file of listMdFiles(root)) {
      if (file.toLowerCase() === "readme.md") continue;
      const nm = readName(path.join(root, file));
      if (nm) names.add(normName(nm));
    }
  }
  return names;
}

/**
 * Split candidates into [newOnes, alreadyInstalled] by normalized name.
 * newOnes are the ones to recommend; alreadyInstalled the ones to optionally
 * note ("you already have this").
 */
export function filterCandidates(candidates, installed) {
  if (installed === undefined) installed = installedSkillNames();
  const newOnes = [];
  const have = [];
  for (const c of candidates) {
    if (installed.has(normName(c.name || ""))) have.push(c);
    else newOnes.push(c);
  }
  return [newOnes, have];
}

export { normName };
