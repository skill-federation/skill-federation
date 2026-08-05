import { createHash } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, posix, resolve } from 'node:path'

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_FILES = 500
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 100 * 1024 * 1024
const FETCH_TIMEOUT_MS = 120_000
const PROVENANCE_FILE = '.skillfed.json'
const UNSAFE_LICENSES = new Set([
  '', 'all rights reserved', 'custom', 'noassertion', 'none', 'not-found', 'proprietary',
  'review', 'unknown', 'unlicensed',
])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

// Record-derived strings are attacker-influenced; strip terminal control characters before
// they can reach an error message (and from there, a terminal escape sequence).
export function sanitizeForDisplay(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
}

function normalizeSite(site) {
  let parsed
  try {
    parsed = new URL(site)
  } catch {
    throw new Error(`invalid SkillFed site URL: ${site}`)
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (
    (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:'))
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new Error('SkillFed site must be an https:// origin without credentials or a path')
  }
  return parsed.origin
}

function validateIdSegment(segment) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
    || segment === '.'
    || segment === '..'
    || segment.endsWith('.')
    || WINDOWS_RESERVED.test(segment)
  ) {
    throw new Error(`invalid skill identifier segment: ${segment}`)
  }
  return segment
}

export function parseSkillReference(reference, site = 'https://skillfed.io') {
  const origin = normalizeSite(site)
  const value = String(reference ?? '').trim()
  if (!value) throw new Error('a skill slug or skillfed.io URL is required')

  let rawSegments
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    let parsed
    try {
      parsed = new URL(value)
    } catch {
      throw new Error(`invalid skill URL: ${value}`)
    }
    if (
      parsed.origin !== origin
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      throw new Error(`skill URL must be a clean URL on ${origin}`)
    }
    rawSegments = parsed.pathname.split('/').filter(Boolean)
  } else {
    if (value.includes('?') || value.includes('#') || value.includes('\\')) {
      throw new Error('skill slug must be owner/repository/skill')
    }
    rawSegments = value.split('/')
  }

  if (rawSegments.length !== 3 || rawSegments.some((part) => !part)) {
    throw new Error('skill slug must be owner/repository/skill')
  }
  const segments = rawSegments.map((part) => {
    let decoded
    try {
      decoded = decodeURIComponent(part)
    } catch {
      throw new Error(`invalid URL encoding in skill identifier: ${part}`)
    }
    if (decoded.includes('/') || decoded.includes('\\')) {
      throw new Error('encoded path separators are not allowed in a skill identifier')
    }
    return validateIdSegment(decoded)
  })
  const id = segments.join('/')
  const apiPath = segments.map(encodeURIComponent).join('/')
  return {
    id,
    segments,
    origin,
    manifestUrl: `${origin}/api/skills/${apiPath}.json`,
  }
}

function safeRecordPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) {
    throw new Error('published file has an unsafe path')
  }
  if (value.startsWith('/') || posix.isAbsolute(value) || posix.normalize(value) !== value) {
    throw new Error(`published file has an unsafe path: ${value}`)
  }
  const segments = value.split('/')
  for (const segment of segments) {
    if (
      !segment
      || segment === '.'
      || segment === '..'
      || /[<>:"|?*]/.test(segment)
      || /[\u0000-\u001f\u007f]/.test(segment)
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || WINDOWS_RESERVED.test(segment)
    ) {
      throw new Error(`published file has an unsafe path: ${value}`)
    }
  }
  return value
}

function validateFileUrl(value, origin) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`published file has an invalid URL: ${value}`)
  }
  if (
    parsed.origin !== origin
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.pathname.startsWith('/files/')
  ) {
    throw new Error(`published file URL must stay under ${origin}/files/`)
  }
  return parsed.href
}

export function validatePublishedRecord(record, expectedId, site = 'https://skillfed.io', options = {}) {
  const origin = normalizeSite(site)
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('published skill record must be a JSON object')
  }
  if (record.id !== expectedId) {
    throw new Error(`published skill id mismatch: expected ${expectedId}, got ${sanitizeForDisplay(record.id ?? 'missing')}`)
  }

  // License-gated records publish no files[] and point at an external repository instead.
  // Detect that BEFORE the license gate, so the error never suggests --allow-unlicensed.
  const external = record.install
  if (
    (!Array.isArray(record.files) || record.files.length === 0)
    && external && typeof external === 'object' && !Array.isArray(external)
    && external.mode === 'external'
    && typeof external.repo === 'string' && external.repo.trim()
  ) {
    throw new Error(`this skill is not published for direct install; get it from ${sanitizeForDisplay(external.repo.trim())}`)
  }

  const license = String(record.meta?.license ?? record.license ?? '').trim()
  if (!options.allowUnlicensed && UNSAFE_LICENSES.has(license.toLowerCase())) {
    throw new Error(`skill license is '${sanitizeForDisplay(license) || 'missing'}'; pass --allow-unlicensed to acknowledge the risk`)
  }
  const rawVerdict = record.security?.verdict
  const security = {
    verdict: typeof rawVerdict === 'string' && rawVerdict.trim() ? rawVerdict.trim().toLowerCase() : null,
    scannedAt: typeof record.security?.scanned_at === 'string' ? record.security.scanned_at : null,
  }
  if (!Array.isArray(record.files) || record.files.length === 0 || record.files.length > MAX_FILES) {
    throw new Error(`published skill must contain between 1 and ${MAX_FILES} files`)
  }

  let declaredTotal = 0
  const files = record.files.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error('published file entry must be a JSON object')
    }
    const path = safeRecordPath(file.path)
    if (basename(path).toLowerCase() === PROVENANCE_FILE) {
      throw new Error('published skill contains a reserved path')
    }
    const bytes = Number(file.bytes)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FILE_BYTES) {
      throw new Error(`published file has an invalid size: ${path}`)
    }
    const sha256 = String(file.sha256 ?? '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`published file has an invalid sha256: ${path}`)
    }
    declaredTotal += bytes
    return {
      path,
      bytes,
      sha256,
      url: validateFileUrl(file.url, origin),
    }
  })
  if (declaredTotal > MAX_TOTAL_BYTES) {
    throw new Error(`published skill exceeds the ${MAX_TOTAL_BYTES} byte install limit`)
  }

  const skillFiles = files.filter((file) => basename(file.path) === 'SKILL.md')
  if (skillFiles.length === 0) throw new Error('published skill has no SKILL.md')
  const minDepth = Math.min(...skillFiles.map((file) => file.path.split('/').length))
  const roots = skillFiles.filter((file) => file.path.split('/').length === minDepth)
  if (roots.length !== 1) throw new Error('published skill has an ambiguous root SKILL.md')
  const sourceRoot = posix.dirname(roots[0].path) === '.' ? '' : posix.dirname(roots[0].path)
  const prefix = sourceRoot ? `${sourceRoot}/` : ''

  const seen = new Set()
  const installFiles = files.map((file) => {
    if (prefix && !file.path.startsWith(prefix)) {
      throw new Error(`published file is outside the skill root: ${file.path}`)
    }
    const relativePath = prefix ? file.path.slice(prefix.length) : file.path
    const folded = relativePath.toLowerCase()
    if (seen.has(folded)) throw new Error(`published skill contains a duplicate path: ${relativePath}`)
    seen.add(folded)
    return { ...file, relativePath }
  })

  return { id: expectedId, license, security, files: installFiles, declaredTotal }
}

// Read a response body without ever buffering more than `limit` bytes: a streaming read is
// aborted the moment the total crosses the limit, so a lying content-length (or a server that
// just keeps sending) cannot exhaust memory. Test mocks without a stream fall back to
// arrayBuffer + a post-hoc check.
async function readBodyCapped(response, limit, url) {
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > limit) {
        await reader.cancel().catch(() => {})
        throw new Error(`download exceeds the ${limit} byte limit: ${url}`)
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > limit) throw new Error(`download exceeds the ${limit} byte limit: ${url}`)
  return bytes
}

async function fetchBytes(url, fetchImpl, limit) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'skillfed-installer/0.2' },
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${url}`)
  if (response.url && new URL(response.url).href !== new URL(url).href) {
    throw new Error(`unexpected redirect while downloading ${url}`)
  }
  const contentLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new Error(`download exceeds the ${limit} byte limit: ${url}`)
  }
  return readBodyCapped(response, limit, url)
}

async function fetchRecord(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'skillfed-installer/0.2' },
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${url}`)
  if (response.url && new URL(response.url).href !== new URL(url).href) {
    throw new Error(`unexpected redirect while fetching ${url}`)
  }
  const bytes = await readBodyCapped(response, MAX_MANIFEST_BYTES, url)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('published skill record is not valid JSON')
  }
}

export async function installPublishedSkill({
  reference,
  site = 'https://skillfed.io',
  skillsDirectory,
  dryRun = false,
  force = false,
  allowUnlicensed = false,
  allowFailedScan = false,
  onPlan,
  fetchImpl = globalThis.fetch,
  renameImpl = renameSync,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('Node 18 or newer is required (fetch is unavailable)')
  const parsed = parseSkillReference(reference, site)
  const installName = parsed.segments[2]
  const root = resolve(skillsDirectory)
  const destination = join(root, installName)
  const backup = `${destination}.bak`

  // Destination pre-checks come before any fetch: a doomed install should touch the network
  // no more than it touches the disk.
  if (existsSync(destination) && !force) {
    throw new Error(`${destination} already exists; pass --force to replace it`)
  }
  if (force && existsSync(destination) && existsSync(backup)) {
    throw new Error(`${backup} already exists; move or remove it before using --force`)
  }

  const record = await fetchRecord(parsed.manifestUrl, fetchImpl)
  const plan = validatePublishedRecord(record, parsed.id, parsed.origin, { allowUnlicensed })
  if (plan.security.verdict === 'fail' && !allowFailedScan) {
    throw new Error("the published security scan verdict is 'fail'; pass --allow-failed-scan to install anyway")
  }

  // The caller sees the full plan (verdict, license, files) before a single byte is written.
  onPlan?.({ ...plan, destination, dryRun })
  if (dryRun) return { ...plan, destination, replacedId: null, dryRun: true }

  mkdirSync(root, { recursive: true })
  const temporary = mkdtempSync(join(root, `.${installName}.tmp-`))
  try {
    for (const file of plan.files) {
      const bytes = await fetchBytes(file.url, fetchImpl, file.bytes)
      if (bytes.length !== file.bytes) {
        throw new Error(`size mismatch for ${file.relativePath}: expected ${file.bytes}, got ${bytes.length}`)
      }
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== file.sha256) {
        throw new Error(`sha256 mismatch for ${file.relativePath}`)
      }
      const output = join(temporary, ...file.relativePath.split('/'))
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, bytes, { mode: 0o644 })
    }

    // Provenance: what was installed, from where, verified against which hashes. The record
    // may not ship a file by this name (validatePublishedRecord reserves it).
    writeFileSync(join(temporary, PROVENANCE_FILE), `${JSON.stringify({
      id: plan.id,
      origin: parsed.origin,
      license: plan.license,
      security: plan.security,
      version: record.version ?? null,
      files: plan.files.map((file) => ({ path: file.relativePath, bytes: file.bytes, sha256: file.sha256 })),
      installed_at: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o644 })

    let replacedId = null
    if (force && existsSync(destination)) {
      try {
        const previous = JSON.parse(readFileSync(join(destination, PROVENANCE_FILE), 'utf8'))
        if (typeof previous?.id === 'string' && previous.id !== plan.id) replacedId = previous.id
      } catch { /* no readable provenance — nothing to warn about */ }
    }

    let movedExisting = false
    try {
      if (existsSync(destination)) {
        renameImpl(destination, backup)
        movedExisting = true
      }
      renameImpl(temporary, destination)
    } catch (error) {
      if (movedExisting && !existsSync(destination) && existsSync(backup)) {
        renameImpl(backup, destination)
      }
      throw error
    }
    return { ...plan, destination, backup: movedExisting ? backup : null, replacedId, dryRun: false }
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true })
    throw error
  }
}
