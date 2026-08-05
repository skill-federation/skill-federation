import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
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
      /byte limit|size mismatch|sha256 mismatch/,
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

test('force replaces an existing skill and keeps the old content in .bak', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const oldBody = '---\nname: resume-helper\n---\n# Old\n'
  const newBody = '---\nname: resume-helper\n---\n# New\n'
  const oldRecord = publishedRecord(oldBody)
  const newRecord = publishedRecord(newBody)
  try {
    await installPublishedSkill({
      reference: oldRecord.id,
      skillsDirectory: root,
      fetchImpl: mockFetch(oldRecord, {
        [oldRecord.files[0].url]: oldBody,
        [oldRecord.files[1].url]: '# Notes\n',
      }, []),
    })
    const result = await installPublishedSkill({
      reference: newRecord.id,
      skillsDirectory: root,
      force: true,
      fetchImpl: mockFetch(newRecord, {
        [newRecord.files[0].url]: newBody,
        [newRecord.files[1].url]: '# Notes\n',
      }, []),
    })
    assert.equal(result.backup, path.join(root, 'resume-helper.bak'))
    assert.equal(readFileSync(path.join(root, 'resume-helper', 'SKILL.md'), 'utf8'), newBody)
    assert.equal(readFileSync(path.join(root, 'resume-helper.bak', 'SKILL.md'), 'utf8'), oldBody)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('force refuses an existing .bak before any fetch', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const record = publishedRecord('---\nname: resume-helper\n---\n')
  const calls = []
  try {
    mkdirSync(path.join(root, 'resume-helper'), { recursive: true })
    mkdirSync(path.join(root, 'resume-helper.bak'), { recursive: true })
    await assert.rejects(
      installPublishedSkill({
        reference: record.id,
        skillsDirectory: root,
        force: true,
        fetchImpl: mockFetch(record, {}, calls),
      }),
      /already exists; move or remove/,
    )
    assert.equal(calls.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a stale .bak is not misreported as this run\'s backup', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\n'
  const record = publishedRecord(skillBody)
  try {
    mkdirSync(path.join(root, 'resume-helper.bak'), { recursive: true })
    const result = await installPublishedSkill({
      reference: record.id,
      skillsDirectory: root,
      fetchImpl: mockFetch(record, {
        [record.files[0].url]: skillBody,
        [record.files[1].url]: '# Notes\n',
      }, []),
    })
    assert.equal(result.backup, null)
    assert.equal(existsSync(path.join(root, 'resume-helper', 'SKILL.md')), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed swap rolls the original destination back', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const oldBody = '---\nname: resume-helper\n---\n# Old\n'
  const newBody = '---\nname: resume-helper\n---\n# New\n'
  const oldRecord = publishedRecord(oldBody)
  const newRecord = publishedRecord(newBody)
  try {
    await installPublishedSkill({
      reference: oldRecord.id,
      skillsDirectory: root,
      fetchImpl: mockFetch(oldRecord, {
        [oldRecord.files[0].url]: oldBody,
        [oldRecord.files[1].url]: '# Notes\n',
      }, []),
    })
    let renames = 0
    await assert.rejects(
      installPublishedSkill({
        reference: newRecord.id,
        skillsDirectory: root,
        force: true,
        renameImpl: (from, to) => {
          renames += 1
          if (renames === 2) throw new Error('simulated rename failure')
          renameSync(from, to)
        },
        fetchImpl: mockFetch(newRecord, {
          [newRecord.files[0].url]: newBody,
          [newRecord.files[1].url]: '# Notes\n',
        }, []),
      }),
      /simulated rename failure/,
    )
    assert.equal(readFileSync(path.join(root, 'resume-helper', 'SKILL.md'), 'utf8'), oldBody)
    assert.equal(existsSync(path.join(root, 'resume-helper.bak')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a same-length tampered body fails the sha256 check specifically', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\nAAAA\n'
  const tampered = '---\nname: resume-helper\n---\nAAAB\n'
  const record = publishedRecord(skillBody)
  try {
    await assert.rejects(
      installPublishedSkill({
        reference: record.id,
        skillsDirectory: root,
        fetchImpl: mockFetch(record, {
          [record.files[0].url]: tampered,
          [record.files[1].url]: '# Notes\n',
        }, []),
      }),
      /sha256 mismatch/,
    )
    assert.equal(existsSync(path.join(root, 'resume-helper')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a response landing on a different URL is an unexpected redirect', async () => {
  const record = publishedRecord('---\nname: resume-helper\n---\n')
  await assert.rejects(
    installPublishedSkill({
      reference: record.id,
      skillsDirectory: path.join(tmpdir(), 'skillfed-install-redirect'),
      dryRun: true,
      fetchImpl: async () => response(JSON.stringify(record), `${SITE}/api/skills/elsewhere.json`),
    }),
    /unexpected redirect/,
  )
})

test('a failed security scan blocks the install unless acknowledged', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\n'
  const record = {
    ...publishedRecord(skillBody),
    security: { verdict: ' FAIL ', scanned_at: '2026-08-01T00:00:00Z' },
  }
  try {
    await assert.rejects(
      installPublishedSkill({
        reference: record.id,
        skillsDirectory: root,
        fetchImpl: mockFetch(record, {}, []),
      }),
      /--allow-failed-scan/,
    )
    const result = await installPublishedSkill({
      reference: record.id,
      skillsDirectory: root,
      allowFailedScan: true,
      fetchImpl: mockFetch(record, {
        [record.files[0].url]: skillBody,
        [record.files[1].url]: '# Notes\n',
      }, []),
    })
    assert.equal(result.security.verdict, 'fail')
    assert.equal(result.security.scannedAt, '2026-08-01T00:00:00Z')

    const unscanned = validatePublishedRecord(publishedRecord(skillBody), record.id)
    assert.equal(unscanned.security.verdict, null)
    assert.equal(unscanned.security.scannedAt, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an external-only record points at its repo, never at --allow-unlicensed', () => {
  const record = {
    id: 'acme/tools/resume-helper',
    meta: { name: 'resume-helper', license: 'proprietary' },
    install: { mode: 'external', repo: 'https://github.com/acme/tools' },
  }
  let error
  try {
    validatePublishedRecord(record, record.id)
  } catch (caught) {
    error = caught
  }
  assert.match(error.message, /not published for direct install/)
  assert.ok(error.message.includes('https://github.com/acme/tools'))
  assert.ok(!error.message.includes('allow-unlicensed'))
})

test('a file path containing a control character is rejected as unsafe', () => {
  const record = publishedRecord('---\nname: resume-helper\n---\n')
  record.files[1].path = 'skills/resume-helper/\u001bevil.md'
  assert.throws(() => validatePublishedRecord(record, record.id), /unsafe path/)
})

test('a successful install writes provenance, and the name is reserved', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\n'
  const record = publishedRecord(skillBody)
  try {
    const result = await installPublishedSkill({
      reference: record.id,
      skillsDirectory: root,
      fetchImpl: mockFetch(record, {
        [record.files[0].url]: skillBody,
        [record.files[1].url]: '# Notes\n',
      }, []),
    })
    const provenance = JSON.parse(readFileSync(path.join(result.destination, '.skillfed.json'), 'utf8'))
    assert.equal(provenance.id, record.id)
    assert.deepEqual(
      provenance.files.map((file) => file.sha256),
      record.files.map((file) => file.sha256),
    )

    const reserved = publishedRecord(skillBody)
    reserved.files[1].path = 'skills/resume-helper/.skillfed.json'
    assert.throws(() => validatePublishedRecord(reserved, reserved.id), /reserved path/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('onPlan fires after the record fetch and before any file download', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'skillfed-install-'))
  const skillBody = '---\nname: resume-helper\n---\n'
  const record = publishedRecord(skillBody)
  const calls = []
  let callsAtPlan = -1
  try {
    await installPublishedSkill({
      reference: record.id,
      skillsDirectory: root,
      onPlan: () => { callsAtPlan = calls.length },
      fetchImpl: mockFetch(record, {
        [record.files[0].url]: skillBody,
        [record.files[1].url]: '# Notes\n',
      }, calls),
    })
    assert.equal(callsAtPlan, 1)
    assert.equal(calls.length, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the npm package publishes the install implementation', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'installer', 'package.json'), 'utf8'))
  assert.ok(pkg.files.includes('install-skill.mjs'))
})
