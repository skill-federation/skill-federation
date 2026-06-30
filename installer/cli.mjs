#!/usr/bin/env node
// Skill Federation — no-clone installer (Node tier, `npx skillfed`).
//
// Same curl-tier install as install.sh/install.ps1, but distributed through npm so users
// run it with no clone, no execution-policy wrangling, and an auto-updating version pin:
//   npx skillfed                      # curl tier, user scope (~/.claude)
//   npx skillfed --with-hook          # + plan-approval nudge (safe settings.json merge)
//   npx skillfed --with-npx           # + register the npx -y skillfed-mcp MCP server
//   npx skillfed --scope project      # install into ./.claude instead of ~/.claude
//
// The 3 payload files are vendored into ./payload at pack time (scripts/vendor-payload.mjs,
// wired to npm `prepack`). When run straight from a clone before vendoring, we fall back to
// the canonical source under ../integrations/claude-code — so this works either way.
// Zero runtime dependencies: stdlib only.

import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

// Each payload file: where it's bundled, the clone fallback, and where it lands under .claude.
const PAYLOAD = [
  {
    bundled: join(HERE, 'payload', 'SKILL.md'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'skills', 'skill-federation', 'SKILL.md'),
    dest: ['skills', 'skill-federation', 'SKILL.md'],
  },
  {
    bundled: join(HERE, 'payload', 'plan_nudge.json'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'hooks', 'plan_nudge.json'),
    dest: ['skills', 'skill-federation', 'plan_nudge.json'],
  },
  {
    bundled: join(HERE, 'payload', 'skillfed.md'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'commands', 'skillfed.md'),
    dest: ['commands', 'skillfed.md'],
  },
]

function parse() {
  const { values } = parseArgs({
    options: {
      scope: { type: 'string', default: 'user' },
      target: { type: 'string' },
      'with-hook': { type: 'boolean', default: false },
      'with-npx': { type: 'boolean', default: false },
      endpoint: { type: 'string', default: 'https://qurini-skill-federation.hf.space' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log('Usage: npx skillfed [--scope user|project] [--target <dir>] [--with-hook] [--with-npx] [--endpoint <url>]')
    process.exit(0)
  }
  if (values.scope !== 'user' && values.scope !== 'project') {
    console.error(`error: --scope must be 'user' or 'project' (got '${values.scope}')`)
    process.exit(2)
  }
  return values
}

// Resolve one payload file's on-disk source: prefer the vendored copy, fall back to the clone.
function sourceOf(p) {
  if (existsSync(p.bundled)) return p.bundled
  if (existsSync(p.source)) return p.source
  console.error(`error: payload missing (${p.bundled}). Run scripts/vendor-payload.mjs, or install from the published package.`)
  process.exit(1)
}

function backup(path) {
  if (existsSync(path)) {
    copyFileSync(path, `${path}.bak`)
    console.log(`  backed up -> ${path}.bak`)
  }
}

function readJson(path) {
  if (existsSync(path) && statSync(path).size > 0) {
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  return {}
}

function writeJson(obj, path) {
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`)
}

function main() {
  const opts = parse()
  const target = opts.target
    ? resolve(opts.target)
    : opts.scope === 'user'
      ? join(homedir(), '.claude')
      : join(process.cwd(), '.claude')

  console.log('Skill Federation installer (npx skillfed)')
  console.log(`  target : ${target}  (scope=${opts.scope})`)
  console.log('')

  // ALWAYS: curl tier (skill + command) — plain file writes, works immediately.
  const skillDir = join(target, 'skills', 'skill-federation')
  const cmdDir = join(target, 'commands')
  mkdirSync(skillDir, { recursive: true })
  mkdirSync(cmdDir, { recursive: true })
  for (const p of PAYLOAD) {
    copyFileSync(sourceOf(p), join(target, ...p.dest))
  }
  console.log('[curl] installed finder skill + /skillfed command (zero runtime)')

  // --with-hook: register the plan-approval nudge (safe merge + backup, idempotent).
  if (opts['with-hook']) {
    const nudgeAbs = join(skillDir, 'plan_nudge.json').replace(/\\/g, '/')
    const cmd = `curl -s "file://${nudgeAbs}"`
    const settingsPath = join(target, 'settings.json')
    const s = readJson(settingsPath)
    s.hooks ??= {}
    s.hooks.PostToolUse ??= []
    const already = s.hooks.PostToolUse.some(
      (e) => Array.isArray(e?.hooks) && e.hooks.some((h) => String(h?.command).includes('plan_nudge.json')),
    )
    if (already) {
      console.log('[hook] already registered; skipped')
    } else {
      backup(settingsPath)
      s.hooks.PostToolUse.push({
        matcher: 'ExitPlanMode',
        hooks: [{ type: 'command', command: cmd, timeout: 20 }],
      })
      writeJson(s, settingsPath)
      console.log('[hook] registered plan-approval nudge in settings.json')
    }
  }

  // --with-npx: register the published Node MCP server (project-scoped .mcp.json).
  if (opts['with-npx']) {
    const mcpPath = join(process.cwd(), '.mcp.json')
    const m = readJson(mcpPath)
    m.mcpServers ??= {}
    backup(mcpPath)
    m.mcpServers['skillfed-mcp'] = {
      command: 'npx',
      args: ['-y', 'skillfed-mcp'],
      env: { SKILLFED_ENDPOINT: opts.endpoint },
    }
    writeJson(m, mcpPath)
    console.log(`[npx] registered Node MCP server -> ${mcpPath} (npx -y skillfed-mcp)`)
  }

  console.log('')
  console.log('Done. Restart Claude Code, then run:  /skillfed <what you\'re trying to do>')
  console.log(`Endpoint: ${opts.endpoint}  (override with $SKILLFED_ENDPOINT)`)
}

main()
