import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLI = path.join(ROOT, 'installer', 'cli.mjs')

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

// Spawn the real CLI. process.execPath + the inherited environment make this work both under
// plain node and under an Electron-as-Node runner (ELECTRON_RUN_AS_NODE rides along).
function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }))
  })
}

test('install --dry-run prints the plan from a local record server', async () => {
  const skillBody = '---\nname: s\n---\n'
  const server = createServer((request, response) => {
    if (request.url === '/api/skills/o/r/s.json') {
      const origin = `http://127.0.0.1:${server.address().port}`
      const record = {
        id: 'o/r/s',
        meta: { name: 's', license: 'MIT' },
        files: [{
          path: 'skills/s/SKILL.md',
          bytes: Buffer.byteLength(skillBody),
          sha256: digest(skillBody),
          url: `${origin}/files/o/r/s/SKILL.md`,
        }],
      }
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(record))
      return
    }
    response.statusCode = 404
    response.end('missing')
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const target = mkdtempSync(path.join(tmpdir(), 'skillfed-cli-'))
  try {
    const site = `http://127.0.0.1:${server.address().port}`
    const result = await runCli(['install', 'o/r/s', '--dry-run', '--site', site, '--target', target])
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('o/r/s'), result.stdout)
    assert.ok(result.stdout.includes('(dry run)'), result.stdout)
    assert.ok(result.stdout.includes('scan   : not scanned'), result.stdout)
  } finally {
    server.close()
    rmSync(target, { recursive: true, force: true })
  }
})

test('install rejects finder-only flags', async () => {
  const result = await runCli(['install', 'o/r/s', '--with-npx'])
  assert.equal(result.code, 2)
})

test('install-only flags without the install command exit 2', async () => {
  const result = await runCli(['--force'])
  assert.equal(result.code, 2)
})

test('install rejects a non-default --endpoint', async () => {
  const result = await runCli(['install', 'o/r/s', '--endpoint', 'https://x.example'])
  assert.equal(result.code, 2)
})
