import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, '..', 'cli.mjs')

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function withSearchServer(run) {
  let received
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      received = {
        method: request.method,
        path: request.url,
        body: JSON.parse(body),
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        query_id: 'q_test',
        action: 'choose',
        confidence: 0.71,
        candidates: [{
          skill_id: 'example__postgresql-optimization',
          name: 'postgresql-optimization',
          description: 'Diagnose slow queries with EXPLAIN and index analysis.',
          score: 0.663,
          trust: {
            license: 'MIT',
            license_class: 'permissive',
            provenance: 'verified',
            stars: 42,
          },
          source_url: 'https://github.com/example/skills',
        }, {
          skill_id: 'mirror__postgresql-optimization',
          name: 'postgresql-optimization',
          description: 'A lower-ranked mirrored copy.',
          score: 0.61,
          trust: {
            license_class: 'review',
            provenance: 'verified',
          },
          source_url: 'https://github.com/example/mirror',
        }, {
          skill_id: 'example__database-patterns',
          name: 'database-patterns',
          description: 'Database indexing and query tuning patterns.',
          score: 0.59,
          trust: {
            license_class: 'review',
            provenance: 'verified',
          },
          source_url: 'https://github.com/example/database-patterns',
        }],
      }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    await run(`http://127.0.0.1:${address.port}`, () => received)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('find sends only the supplied wish and prints trust-aware results', async () => {
  await withSearchServer(async (endpoint, getReceived) => {
    const query = 'optimize a slow PostgreSQL query'
    const result = await runCli(['find', query, '--endpoint', endpoint, '--top', '3'])

    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /postgresql-optimization/)
    assert.match(result.stdout, /permissive · verified · MIT · 42 stars/)
    assert.match(result.stdout, /this exact text was sent/)
    assert.match(result.stdout, /2 candidates/)
    assert.equal(result.stdout.match(/postgresql-optimization/g)?.length, 1)
    assert.deepEqual(getReceived(), {
      method: 'POST',
      path: '/search',
      body: {
        tenant: 'skillfed-cli',
        wish: query,
        keywords: [],
        top_n: 6,
      },
    })
  })
})

test('find --json returns the service response as JSON', async () => {
  await withSearchServer(async (endpoint) => {
    const result = await runCli(['find', 'extract tables from PDFs', '--endpoint', endpoint, '--json'])

    assert.equal(result.code, 0, result.stderr)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.query_id, 'q_test')
    assert.equal(parsed.candidates[0].name, 'postgresql-optimization')
    assert.equal(parsed.candidates[1].name, 'database-patterns')
    assert.equal(parsed.candidates.length, 2)
  })
})

test('find requires a wish', async () => {
  const result = await runCli(['find'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /provide an abstract capability wish/)
})
