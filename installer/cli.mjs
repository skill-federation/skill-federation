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
const DEFAULT_ENDPOINT = 'https://qurini-skill-federation.hf.space'
const DEFAULT_TOP_N = 5
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

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
  const { values, positionals } = parseArgs({
    options: {
      scope: { type: 'string', default: 'user' },
      target: { type: 'string' },
      'with-hook': { type: 'boolean', default: false },
      'with-npx': { type: 'boolean', default: false },
      endpoint: {
        type: 'string',
        default: process.env.SKILLFED_ENDPOINT || DEFAULT_ENDPOINT,
      },
      top: { type: 'string', default: String(DEFAULT_TOP_N) },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  if (values.help) {
    console.log(`Usage:
  npx skillfed find "<abstract capability wish>" [--top 5] [--json] [--endpoint <url>]
  npx skillfed [--scope user|project] [--target <dir>] [--with-hook] [--with-npx] [--endpoint <url>]

Examples:
  npx skillfed find "optimize a slow PostgreSQL query using EXPLAIN and indexes"
  npx skillfed

The find command sends only the exact search text you provide. Do not include code, secrets,
customer data, or other private task context.`)
    process.exit(0)
  }
  const command = positionals[0] || 'install'
  if (!['install', 'find', 'search'].includes(command)) {
    console.error(`error: unknown command '${command}' (expected 'find' or no command to install)`)
    process.exit(2)
  }
  if (values.scope !== 'user' && values.scope !== 'project') {
    console.error(`error: --scope must be 'user' or 'project' (got '${values.scope}')`)
    process.exit(2)
  }
  const topN = Number.parseInt(values.top, 10)
  if (!Number.isInteger(topN) || topN < 1 || topN > 10) {
    console.error(`error: --top must be an integer from 1 to 10 (got '${values.top}')`)
    process.exit(2)
  }
  return {
    ...values,
    command: command === 'search' ? 'find' : command,
    query: positionals.slice(1).join(' ').trim(),
    topN,
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function search(endpoint, query, topN) {
  const url = `${endpoint.replace(/\/+$/, '')}/search`
  const body = JSON.stringify({
    tenant: 'skillfed-cli',
    wish: query,
    keywords: [],
    top_n: Math.min(10, Math.max(topN, topN * 2)),
  })
  const delays = [0, 1000, 2500]
  let lastError

  for (const delay of delays) {
    if (delay) await sleep(delay)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'skillfed-cli/0.1.3',
        },
        body,
        signal: controller.signal,
      })
      if (response.ok) return await response.json()
      const detail = (await response.text()).trim()
      lastError = new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
      if (!RETRYABLE_STATUS.has(response.status)) break
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
  }

  const detail = lastError?.name === 'AbortError'
    ? 'request timed out while the demo service was waking up'
    : lastError?.message || 'unknown network error'
  throw new Error(`search failed: ${detail}`)
}

function oneLine(value, maxLength = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

function distinctCandidates(candidates, limit) {
  const seen = new Set()
  const distinct = []
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const identity = String(candidate.name || candidate.skill_id || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (!identity || seen.has(identity)) continue
    seen.add(identity)
    distinct.push(candidate)
    if (distinct.length === limit) break
  }
  return distinct
}

function trustSummary(candidate) {
  const trust = candidate.trust || {}
  const parts = [
    trust.license_class,
    trust.provenance,
    trust.license && trust.license !== trust.license_class ? trust.license : null,
    Number.isFinite(trust.stars) ? `${trust.stars} stars` : null,
  ]
  return parts.filter(Boolean).join(' · ') || 'trust metadata unavailable'
}

function printResults(query, result) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : []
  console.log('Skill Federation search')
  console.log(`Wish: ${query}`)
  console.log('Privacy: this exact text was sent; no files or other local context were read.')
  console.log('')

  if (!candidates.length || result.action === 'abstain') {
    console.log('No confident match. Continue without installing a skill.')
    if (result.confidence != null) console.log(`Confidence: ${result.confidence}`)
    return
  }

  console.log(`${candidates.length} candidate${candidates.length === 1 ? '' : 's'} (${result.action || 'choose'}):`)
  candidates.forEach((candidate, index) => {
    const score = Number.isFinite(candidate.score) ? `  score ${candidate.score.toFixed(3)}` : ''
    console.log(`\n${index + 1}. ${candidate.name || candidate.skill_id}${score}`)
    if (candidate.description) console.log(`   ${oneLine(candidate.description)}`)
    console.log(`   Trust: ${trustSummary(candidate)}`)
    if (candidate.source_url) console.log(`   Source: ${candidate.source_url}`)
  })
  console.log('\nReview the source before installing. To add the finder to Claude Code, run: npx skillfed')
}

async function findSkills(opts) {
  if (!opts.query) {
    console.error('error: provide an abstract capability wish, for example:')
    console.error('  npx skillfed find "extract tables from PDF documents"')
    return 2
  }
  try {
    const result = await search(opts.endpoint, opts.query, opts.topN)
    result.candidates = distinctCandidates(result.candidates, opts.topN)
    if (!result.candidates.length) {
      result.action = 'abstain'
    }
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      printResults(opts.query, result)
    }
    return 0
  } catch (error) {
    console.error(`error: ${error.message}`)
    return 1
  }
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

function install(opts) {
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

async function main() {
  const opts = parse()
  if (opts.command === 'find') {
    process.exitCode = await findSkills(opts)
    return
  }
  install(opts)
}

await main()
