#!/usr/bin/env node
// Single source of truth for the curl-tier payload.
//
// integrations/claude-code/ is canonical. The npm and PyPI installer packages must SHIP the
// 3 payload files (so the published artifacts are self-contained and offline), but those copies
// must never be hand-edited — they're vendored from the canonical source by this script.
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

// canonical skill folder + its SKILL.md — the files every consumer of the payload needs
const CANONICAL_SKILL_DIR = join(SRC, 'skills', 'skill-federation')
const CANONICAL_SKILL = join(CANONICAL_SKILL_DIR, 'SKILL.md')

// canonical source -> vendored filename
const FILES = [
  [CANONICAL_SKILL, 'SKILL.md'],
  [join(SRC, 'hooks', 'plan_nudge.json'), 'plan_nudge.json'],
  [join(SRC, 'commands', 'skillfed.md'), 'skillfed.md'],
]

// vendored destinations (one per installer package) — git-ignored, ship-only copies
const DESTS = [
  join(ROOT, 'installer', 'payload'),
  join(ROOT, 'python-installer', 'src', 'skillfed', 'payload'),
]

// COMMITTED scraper-facing pointer. Unlike DESTS (git-ignored), this copy IS tracked in git so
// skill aggregators/finders that walk the GitHub tree for a conventional `skills/<name>/SKILL.md`
// discover us. The WHOLE canonical skill folder is mirrored (SKILL.md + demand-sketch.md + any
// future siblings) so the copy is self-contained — relative links resolve and `gh skill install`
// gets a complete skill. Generated here, never hand-edited; a CI drift-guard
// (.github/workflows/skill-sync.yml) re-runs this script and fails on any diff under `skills/`.
const ROOT_SKILL_DIR = join(ROOT, 'skills', 'skill-federation')

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

// committed root pointer — mirror the full canonical skill folder (flat; no nested dirs today)
mkdirSync(ROOT_SKILL_DIR, { recursive: true })
let rootN = 0
for (const name of readdirSync(CANONICAL_SKILL_DIR)) {
  const src = join(CANONICAL_SKILL_DIR, name)
  if (!statSync(src).isFile()) continue
  copyFileSync(src, join(ROOT_SKILL_DIR, name))
  rootN++
}
n += rootN

console.log(`vendor-payload: copied ${FILES.length} files into ${DESTS.length} package(s) + ${rootN}-file root pointer (${n} writes)`)
