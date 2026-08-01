#!/usr/bin/env node
// Single source of truth for the curl-tier payload.
//
// integrations/claude-code/ is canonical. The npm and PyPI installer packages must SHIP the
// 6 payload files (so the published artifacts are self-contained and offline), but those copies
// must never be hand-edited — they're vendored from the canonical source by this script.
//
// Anything SKILL.md links to relatively must be in FILES, or the curl-tier install ships a
// dead link (that is how demand-sketch.md was missing for three releases). mcp-server/test/
// asserts it: every relative markdown link target in a vendored .md is itself vendored.
//
// Run it before building either installer package:
//   node scripts/vendor-payload.mjs
// npm runs it automatically via installer/package.json "prepack". The Python build expects it
// to have been run first (the vendored dir is git-ignored). Idempotent; safe to re-run.

import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'integrations', 'claude-code')

// canonical skills live here. The installer payload ships ONLY the finder skill
// (skill-federation) — its SKILL.md and the sibling doc that SKILL.md links to; the root
// mirror below exposes EVERY skill for aggregators.
const SRC_SKILLS = join(SRC, 'skills')
const FINDER = join(SRC_SKILLS, 'skill-federation')
const CANONICAL_SKILL = join(FINDER, 'SKILL.md')

// canonical source -> vendored filename. Flat by design: every installer drops these
// side by side, so start_nudge.sh finds plan_start_nudge.json next to itself and
// SKILL.md finds demand-sketch.md next to itself.
const FILES = [
  [CANONICAL_SKILL, 'SKILL.md'],
  [join(FINDER, 'demand-sketch.md'), 'demand-sketch.md'],
  [join(SRC, 'hooks', 'plan_nudge.json'), 'plan_nudge.json'],
  [join(SRC, 'hooks', 'plan_start_nudge.json'), 'plan_start_nudge.json'],
  [join(SRC, 'hooks', 'start_nudge.sh'), 'start_nudge.sh'],
  [join(SRC, 'commands', 'skillfed.md'), 'skillfed.md'],
]

// vendored destinations (one per installer package) — git-ignored, ship-only copies
const DESTS = [
  join(ROOT, 'installer', 'payload'),
  join(ROOT, 'python-installer', 'src', 'skillfed', 'payload'),
]

// COMMITTED scraper-facing mirror. Unlike DESTS (git-ignored), these copies ARE tracked in git so
// skill aggregators/finders that walk the GitHub tree for a conventional `skills/<name>/SKILL.md`
// discover every skill we ship. Each canonical skill folder is mirrored whole (SKILL.md + any
// sibling docs) so the copy is self-contained — relative links resolve and `gh skill install`
// gets a complete skill. Generated here, never hand-edited; a CI drift-guard
// (.github/workflows/skill-sync.yml) re-runs this script and fails on any diff under `skills/`.
const ROOT_SKILLS = join(ROOT, 'skills')

let n = 0
for (const dest of DESTS) {
  mkdirSync(dest, { recursive: true })
  for (const [src, name] of FILES) {
    if (!existsSync(src)) {
      console.error(`vendor-payload: missing canonical source ${src}`)
      process.exit(1)
    }
    copyFileSync(src, join(dest, name))
    n++
  }
}

// committed root mirror — every canonical skill folder → skills/<name>/ (files only; flat today)
let rootN = 0
let skillCount = 0
for (const skill of readdirSync(SRC_SKILLS)) {
  const srcDir = join(SRC_SKILLS, skill)
  if (!statSync(srcDir).isDirectory()) continue
  const destDir = join(ROOT_SKILLS, skill)
  mkdirSync(destDir, { recursive: true })
  skillCount++
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name)
    if (!statSync(src).isFile()) continue
    copyFileSync(src, join(destDir, name))
    rootN++
  }
}
n += rootN

console.log(`vendor-payload: copied ${FILES.length} files into ${DESTS.length} package(s) + ${rootN} files across ${skillCount} root skill(s) (${n} writes)`)
