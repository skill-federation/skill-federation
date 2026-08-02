import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import {
  installPublishedSkill,
  parseSkillReference,
  validatePublishedRecord,
} from '../../installer/install-skill.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SITE = 'https://skillfed.io'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function response(value, url, status = 200) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value)
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(body.length) : null },
    arrayBuffer: async () => body,
  }
}

function publishedRecord(skillBody, referenceBody = '# Notes\n') {
  return {
    id: 'acme/tools/resume-helper',
    slug: 'resume-helper',
    meta: { name: 'resume-helper', license: 'MIT' },
    files: [
      {
        path: 'skills/resume-helper/SKILL.md',
        bytes: Buffer.byteLength(skillBody),
        sha256: digest(skillBody),
        url: `${SITE}/files/acme/tools/resume-helper/SKILL.md`,
      },
      {
        path: 'skills/resume-helper/references/notes.md',
        bytes: Buffer.byteLength(referenceBody),
        sha256: digest(referenceBody),
        url: `${SITE}/files/acme/tools/resume-helper/references/notes.md`,
      },
    ],
  }
}

function mockFetch(record, files, calls) {
  return async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('.json')) return response(JSON.stringify(record), url)
    if (Object.hasOwn(files, url)) return response(files[url], url)
    return response('missing', url, 404)
  }
}

test('skill references accept a canonical slug or skillfed.io URL', () => {
  const slug = parseSkillReference('acme/tools/resume-helper')
  const url = parseSkillReference('https://skillfed.io/acme/tools/resume-helper')
  assert.equal(slug.id, 'acme/tools/resume-helper')
  assert.equal(url.id, slug.id)
  assert.equal(slug.manifestUrl, `${SITE}/api/skills/acme/tools/resume-helper.json`)
})

test('skill references reject foreign origins and path traversal', () => {
  assert.throws(
    () => parseSkillReference('https://example.com/acme/tools/resume-helper'),
    /clean URL on/,
  )
  assert.throws(() => parseSkillReference('acme/tools/../resume-helper'), /owner\/repository\/skill/)
  assert.throws(() => parseSkillReference('acme/tools/%2fetc'), /encoded path separators/)
  assert.throws(() => parseSkillReference('acme/tools/resume-helper?x=1'), /owner\/repository\/skill/)
})

test('published records enforce id, license, same-origin files, and a safe skill root', () => {
  const skillBody = '---\nname: resume-helper\n---\n'
  const record = publishedRecord(skillBody)
  const plan = validatePublishedRecord(record, record.id)
  assert.deepEqual(plan.files.map((file) => file.relativePath), [
    'SKILL.md',
    'references/notes.md',
  ])

  assert.throws(
    () => validatePublishedRecord({ ...record, id: 'other/repo/skill' }, record.id),
    /id mismatch/,
  )
  assert.throws(
    () => validatePublishedRecord({ ...record, meta: { license: 'unlicensed' } }, record.id),
    /allow-unlicensed/,
  )
  const crossOrigin = structuredClone(record)
  crossOrigin.files[0].url = 'https://cdn.example.com/files/SKILL.md'
  assert.throws(() => validatePublishedRecord(crossOrigin, record.id), /must stay under/)
  const traversal = structuredClone(record)
  traversal.files[0].path = 'skills/resume-helper/../SKILL.md'
  assert.throws(() => validatePublishedRecord(traversal, record.id), /unsafe path/)
})

test('published skill install verifies files and writes only the skill subtree', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\n# Resume helper\n'
  const notes = '# Notes\nNo executable content.\n'
  const record = publishedRecord(skillBody, notes)
  const calls = []
  try {
    const result = await installPublishedSkill({
      reference: record.id,
      skillsDirectory: path.join(root, '.claude', 'skills'),
      fetchImpl: mockFetch(record, {
        [record.files[0].url]: skillBody,
        [record.files[1].url]: notes,
      }, calls),
    })
    assert.equal(readFileSync(path.join(result.destination, 'SKILL.md'), 'utf8'), skillBody)
    assert.equal(
      readFileSync(path.join(result.destination, 'references', 'notes.md'), 'utf8'),
      notes,
    )
    assert.equal(calls.length, 3)
    assert.ok(calls.every((call) => call.options.redirect === 'error'))
    await assert.rejects(
      installPublishedSkill({
        reference: record.id,
        skillsDirectory: path.join(root, '.claude', 'skills'),
        fetchImpl: mockFetch(record, {}, []),
      }),
      /already exists/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('checksum failure leaves no partial skill directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\n'
  const record = publishedRecord(skillBody)
  try {
    await assert.rejects(
      installPublishedSkill({
        reference: record.id,
        skillsDirectory: root,
        fetchImpl: mockFetch(record, {
          [record.files[0].url]: `${skillBody}tampered`,
          [record.files[1].url]: '# Notes\n',
        }, []),
      }),
      /size mismatch|sha256 mismatch/,
    )
    assert.equal(existsSync(path.join(root, 'resume-helper')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('dry run validates the manifest without downloading or writing files', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\n'
  const record = publishedRecord(skillBody)
  const calls = []
  try {
    const result = await installPublishedSkill({
      reference: `https://skillfed.io/${record.id}`,
      skillsDirectory: path.join(root, 'skills'),
      dryRun: true,
      fetchImpl: mockFetch(record, {}, calls),
    })
    assert.equal(result.dryRun, true)
    assert.equal(calls.length, 1)
    assert.equal(existsSync(path.join(root, 'skills')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the npm package publishes the install implementation', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'installer', 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('install-skill.mjs'))
})
