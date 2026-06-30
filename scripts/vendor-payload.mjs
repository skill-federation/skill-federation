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
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'integrations', 'claude-code')

// canonical source -> vendored filename
const FILES = [
  [join(SRC, 'skills', 'skill-federation', 'SKILL.md'), 'SKILL.md'],
  [join(SRC, 'hooks', 'plan_nudge.json'), 'plan_nudge.json'],
  [join(SRC, 'commands', 'skillfed.md'), 'skillfed.md'],
]

// vendored destinations (one per installer package)
const DESTS = [
  join(ROOT, 'installer', 'payload'),
  join(ROOT, 'python-installer', 'src', 'skillfed', 'payload'),
]

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
console.log(`vendor-payload: copied ${FILES.length} files into ${DESTS.length} package(s) (${n} writes)`)
