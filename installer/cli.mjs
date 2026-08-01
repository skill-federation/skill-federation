#!/usr/bin/env node
// Skill Federation — no-clone installer (Node tier, `npx skillfed`).
//
// Same curl-tier install as install.sh/install.ps1, but distributed through npm so users
// run it with no clone, no execution-policy wrangling, and an auto-updating version pin:
//   npx skillfed                      # curl tier, user scope (~/.claude) — no hooks
//   npx skillfed --hook end           # + the end-of-plan nudge (safe settings.json merge)
//   npx skillfed --hook both          # + the start-of-plan nudge as well
//   npx skillfed --with-npx           # + register the npx -y skillfed-mcp MCP server
//   npx skillfed --scope project      # install into ./.claude instead of ~/.claude
//
// Hooks are a per-harness convenience and nothing more — they only repeat triggers the skill
// already carries in its own body. The default is --hook none: the skill is complete, and
// portable to any harness (or none at all), with no hook registered.
//
// The 6 payload files are vendored into ./payload at pack time (scripts/vendor-payload.mjs,
// wired to npm `prepack`). When run straight from a clone before vendoring, we fall back to
// the canonical source under ../integrations/claude-code — so this works either way.
// Zero runtime dependencies: stdlib only.

import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync, chmodSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

// Harnesses we know how to install into. `hooks` says whether the harness has a hook
// mechanism at all; --hook is rejected for any harness where it is false.
const HARNESSES = {
  'claude-code': { hooks: true },
}
const HOOK_MODES = ['none', 'start', 'end', 'both']

// Each payload file: where it's bundled, the clone fallback, where it lands under .claude,
// and whether it needs the executable bit on POSIX.
const PAYLOAD = [
  {
    bundled: join(HERE, 'payload', 'SKILL.md'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'skills', 'skill-federation', 'SKILL.md'),
    dest: ['skills', 'skill-federation', 'SKILL.md'],
  },
  {
    bundled: join(HERE, 'payload', 'demand-sketch.md'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'skills', 'skill-federation', 'demand-sketch.md'),
    dest: ['skills', 'skill-federation', 'demand-sketch.md'],
  },
  {
    bundled: join(HERE, 'payload', 'plan_nudge.json'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'hooks', 'plan_nudge.json'),
    dest: ['skills', 'skill-federation', 'plan_nudge.json'],
  },
  {
    bundled: join(HERE, 'payload', 'plan_start_nudge.json'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'hooks', 'plan_start_nudge.json'),
    dest: ['skills', 'skill-federation', 'plan_start_nudge.json'],
  },
  {
    bundled: join(HERE, 'payload', 'start_nudge.sh'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'hooks', 'start_nudge.sh'),
    dest: ['skills', 'skill-federation', 'start_nudge.sh'],
    exec: true,
  },
  {
    bundled: join(HERE, 'payload', 'skillfed.md'),
    source: join(HERE, '..', 'integrations', 'claude-code', 'commands', 'skillfed.md'),
    dest: ['commands', 'skillfed.md'],
  },
]

const HELP = `Usage: npx skillfed [options]

  --scope user|project     where to install (default: user -> ~/.claude)
  --target <dir>           install into an explicit directory instead
  --harness <name>         target harness (default: claude-code; supported: ${Object.keys(HARNESSES).join(', ')})
  --hook none|start|end|both   register 0-2 nudge hooks (default: none)
  --with-hook              legacy alias for --hook end
  --with-npx               also register the npx -y skillfed-mcp MCP server
  --endpoint <url>         federation endpoint to record
  --help

Hooks are a per-harness convenience, not part of the product. They only repeat triggers the
skill already carries in its own body, so the skill works identically with no hook, in any
harness, and with no harness at all. Both nudge files are copied either way, so switching
--hook later never needs a re-fetch.`

function parse() {
  const { values } = parseArgs({
    options: {
      scope: { type: 'string', default: 'user' },
      target: { type: 'string' },
      harness: { type: 'string', default: 'claude-code' },
      hook: { type: 'string' },
      'with-hook': { type: 'boolean', default: false },
      'with-npx': { type: 'boolean', default: false },
      endpoint: { type: 'string', default: 'https://qurini-skill-federation.hf.space' },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    console.log(HELP)
    process.exit(0)
  }
  if (values.scope !== 'user' && values.scope !== 'project') {
    console.error(`error: --scope must be 'user' or 'project' (got '${values.scope}')`)
    process.exit(2)
  }
  if (!Object.hasOwn(HARNESSES, values.harness)) {
    console.error(`error: unknown --harness '${values.harness}'; supported: ${Object.keys(HARNESSES).join(', ')}`)
    process.exit(2)
  }
  if (values.hook !== undefined && !HOOK_MODES.includes(values.hook)) {
    console.error(`error: --hook must be one of ${HOOK_MODES.join('|')} (got '${values.hook}')`)
    process.exit(2)
  }
  // Resolution order: explicit --hook wins, then the legacy --with-hook switch, then none.
  const hook = values.hook ?? (values['with-hook'] ? 'end' : 'none')
  if (hook !== 'none' && !HARNESSES[values.harness].hooks) {
    console.error(`error: harness '${values.harness}' has no hook support — drop --hook/--with-hook. The skill is complete without hooks.`)
    process.exit(2)
  }
  return { ...values, hook }
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

// The 0-2 settings.json entries implied by a hook mode.
//
// `needle` is the idempotency probe, and each one is a substring of ITS OWN command only:
// the start command names start_nudge.sh, the end command names plan_nudge.json, and neither
// string occurs in the other. (Note that "plan_start_nudge.json" does NOT contain
// "plan_nudge.json" either — re-verify by hand if any of these files is ever renamed.)
// The end nudge is curl (ships with Win10+ and macOS). The start nudge is `sh <script>`, and on
// Windows `sh` exists only with Git Bash. UserPromptSubmit fires on EVERY prompt, so a missing
// shell there does not degrade once — it fails on every turn. Warn, don't refuse: hooks are an
// optional convenience, and the user may add Git Bash later without re-installing.
function hasSh() {
  try {
    return spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

function hookEntries(skillDir, mode) {
  const out = []
  if (mode === 'start' || mode === 'both') {
    if (!hasSh()) {
      console.warn(
        "WARN: no 'sh' on PATH — the start-of-plan hook runs `sh <script>` and UserPromptSubmit\n" +
        '      fires on every prompt, so it would fail on every turn rather than once. Install\n' +
        '      Git Bash, or re-run with --hook end. Registering anyway; the skill needs no hook.',
      )
    }
    const startAbs = join(skillDir, 'start_nudge.sh').replace(/\\/g, '/')
    out.push({
      label: 'start-of-plan nudge',
      event: 'UserPromptSubmit',
      needle: 'start_nudge.sh',
      // No `matcher`: UserPromptSubmit carries no tool name to match on. The key is omitted
      // entirely rather than set to null — the script self-gates on permission_mode instead.
      entry: { hooks: [{ type: 'command', command: `sh "${startAbs}"`, timeout: 10 }] },
    })
  }
  if (mode === 'end' || mode === 'both') {
    const nudgeAbs = join(skillDir, 'plan_nudge.json').replace(/\\/g, '/')
    out.push({
      label: 'end-of-plan nudge',
      event: 'PostToolUse',
      needle: 'plan_nudge.json',
      entry: {
        matcher: 'ExitPlanMode',
        hooks: [{ type: 'command', command: `curl -s "file://${nudgeAbs}"`, timeout: 20 }],
      },
    })
  }
  return out
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
  console.log(`  harness: ${opts.harness}  (hooks: ${opts.hook})`)
  console.log('')

  // ALWAYS: curl tier (skill + command) — plain file writes, works immediately.
  // Both nudge files and the gate script are copied whatever the hook mode, so switching
  // --hook later is a settings.json edit and never a re-fetch.
  const skillDir = join(target, 'skills', 'skill-federation')
  const cmdDir = join(target, 'commands')
  mkdirSync(skillDir, { recursive: true })
  mkdirSync(cmdDir, { recursive: true })
  for (const p of PAYLOAD) {
    const dest = join(target, ...p.dest)
    copyFileSync(sourceOf(p), dest)
    if (p.exec && process.platform !== 'win32') {
      try { chmodSync(dest, 0o755) } catch { /* non-fatal: the hook is optional anyway */ }
    }
  }
  console.log('[curl] installed finder skill + /skillfed command (zero runtime)')

  // --hook: register 0-2 nudge entries (safe merge, idempotent, ONE backup before the first write).
  if (opts.hook !== 'none') {
    const settingsPath = join(target, 'settings.json')
    const s = readJson(settingsPath)
    s.hooks ??= {}
    let backedUp = false
    let dirty = false
    for (const e of hookEntries(skillDir, opts.hook)) {
      s.hooks[e.event] ??= []
      const already = s.hooks[e.event].some(
        (x) => Array.isArray(x?.hooks) && x.hooks.some((h) => String(h?.command).includes(e.needle)),
      )
      if (already) {
        console.log(`[hook] ${e.label} already registered; skipped`)
        continue
      }
      if (!backedUp) { backup(settingsPath); backedUp = true }
      s.hooks[e.event].push(e.entry)
      dirty = true
      console.log(`[hook] registered ${e.label} (${e.event}) in settings.json`)
    }
    if (dirty) writeJson(s, settingsPath)
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
