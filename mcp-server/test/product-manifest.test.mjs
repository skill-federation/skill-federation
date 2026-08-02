import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const json = (relative) => JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'))

test('the product manifest agrees with shipped package metadata', () => {
  const manifest = json('product-manifest.json')
  const installer = json('installer/package.json')
  const mcp = json('mcp-server/package.json')

  assert.equal(manifest.release, installer.version)
  assert.equal(manifest.release, mcp.version)
  assert.equal(manifest.packages.npm_installer, installer.name)
  assert.equal(manifest.packages.npm_mcp, mcp.name)
  assert.equal(manifest.site, installer.homepage)
  assert.equal(manifest.repository, 'https://github.com/skill-federation/skill-federation')
  assert.equal(manifest.install.published_skill, 'npx skillfed install <owner/repository/skill>')
  assert.equal(manifest.backend_private, true)
})

test('the manifest distinguishes dynamic catalog scopes instead of publishing one ambiguous count', () => {
  const manifest = json('product-manifest.json')
  assert.deepEqual(Object.keys(manifest.catalog_scopes).sort(), [
    'public_inventory',
    'published_directory',
    'retrieval_backend',
  ])
  assert.equal(JSON.stringify(manifest.catalog_scopes).match(/\b\d{4,}\b/g), null)
})
