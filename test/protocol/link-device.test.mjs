import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

if (!globalThis.Bare) {
  globalThis.Bare = { platform: process.platform }
}

const req = createRequire(import.meta.url)
if (typeof req.addon !== 'function') {
  req.addon = () => ({})
}

describe('link device identity transfer', () => {
  it('inspects storage contents and reports files', async () => {
    const { inspectStorage } = await import('../../backend/backup/inspect.mjs')
    const testDir = join(tmpdir(), `test-link-device-inspect-${Date.now()}`)
    try {
      mkdirSync(testDir, { recursive: true })
      writeFileSync(join(testDir, 'browser-tabs.json'), JSON.stringify([{ url: 'https://test.com' }]))
      mkdirSync(join(testDir, 'hyper'), { recursive: true })
      writeFileSync(join(testDir, 'hyper/block.dat'), 'data')

      const inspection = inspectStorage(testDir)
      assert.equal(inspection.ok, true)
      assert.equal(inspection.path, testDir)
      assert.ok(Array.isArray(inspection.files))

      const tabsItem = inspection.files.find((item) => item.name === 'browser-tabs.json')
      assert.ok(tabsItem)
      assert.equal(tabsItem.type, 'file')
      assert.ok(tabsItem.content.includes('https://test.com'))

      const hyperDir = inspection.files.find((item) => item.name === 'hyper')
      assert.ok(hyperDir)
      assert.equal(hyperDir.type, 'dir')
    } finally {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('handles non-existent storage path gracefully during inspection', async () => {
    const { inspectStorage } = await import('../../backend/backup/inspect.mjs')
    const missingPath = join(tmpdir(), `non-existent-dir-${Date.now()}`)
    const inspection = inspectStorage(missingPath)

    assert.equal(inspection.ok, false)
    assert.equal(inspection.error, 'Storage path does not exist')
    assert.deepEqual(inspection.files, [])
  })
})
