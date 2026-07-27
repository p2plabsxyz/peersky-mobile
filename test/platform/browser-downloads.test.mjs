import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { createRequire } from 'node:module'
import {
  MAX_BROWSER_DOWNLOADS,
  createUniqueDownloadFilename,
  normalizeBrowserDownloads,
  normalizeBrowserDownloadUrl,
  sortBrowserDownloads
} from '../../app/downloads/browser-downloads.mjs'

const require = createRequire(import.meta.url)
const downloadsPlugin = require('../../plugins/with-browser-downloads')

describe('browser downloads', () => {
  test('accepts only safe HTTP download URLs', () => {
    assert.equal(normalizeBrowserDownloadUrl('https://example.com/file.pdf'), 'https://example.com/file.pdf')
    assert.equal(normalizeBrowserDownloadUrl('file:///private.txt'), null)
    assert.equal(normalizeBrowserDownloadUrl('https://user:secret@example.com/file'), null)
    assert.equal(normalizeBrowserDownloadUrl('not a url'), null)
  })

  test('normalizes and bounds native download records', () => {
    const records = Array.from({ length: MAX_BROWSER_DOWNLOADS + 5 }, (_, index) => ({
      id: index + 1,
      name: `file-${index}.txt`,
      status: index === 0 ? 'complete' : 'unknown',
      size: index === 0 ? 42 : -1,
      createdAt: index
    }))
    const downloads = normalizeBrowserDownloads(records)

    assert.equal(downloads.length, MAX_BROWSER_DOWNLOADS)
    assert.equal(downloads[0].id, String(MAX_BROWSER_DOWNLOADS + 5))
    assert.equal(downloads.at(-1).id, '6')
    assert.equal(downloads.every(({ status }) => status === 'failed'), true)
  })

  test('drops malformed records', () => {
    assert.deepEqual(normalizeBrowserDownloads([
      null,
      { id: '', name: 'missing-id' },
      { id: '1', name: '' }
    ]), [])
  })

  test('validates records before retaining the newest 200', () => {
    const malformed = Array.from({ length: MAX_BROWSER_DOWNLOADS + 10 }, () => null)
    const valid = Array.from({ length: MAX_BROWSER_DOWNLOADS + 5 }, (_, index) => ({
      id: `valid-${index}`,
      name: `valid-${index}.txt`,
      status: 'complete',
      size: index,
      createdAt: index
    }))
    const downloads = normalizeBrowserDownloads([...malformed, ...valid])

    assert.equal(downloads.length, MAX_BROWSER_DOWNLOADS)
    assert.equal(downloads[0].id, `valid-${MAX_BROWSER_DOWNLOADS + 4}`)
    assert.equal(downloads.at(-1).id, 'valid-5')
  })

  test('does not split Unicode download names while bounding metadata', () => {
    const name = `${'a'.repeat(254)}😀tail`
    const [download] = normalizeBrowserDownloads([{
      id: '1',
      name,
      status: 'complete',
      size: 1,
      createdAt: 1
    }])

    assert.equal(Array.from(download.name).length, 255)
    assert.equal(download.name.endsWith('😀'), true)
  })

  test('disambiguates duplicate filenames while preserving extensions', () => {
    const downloads = normalizeBrowserDownloads([
      { id: '1', name: 'report.pdf', status: 'complete', size: 1, createdAt: 1 },
      { id: '2', name: 'report.pdf', status: 'complete', size: 1, createdAt: 2 },
      { id: '3', name: 'report.pdf', status: 'complete', size: 1, createdAt: 3 }
    ])

    assert.deepEqual(
      downloads.map((download) => download.name),
      ['report.pdf', 'report (1).pdf', 'report (2).pdf']
    )
  })

  test('sorts downloads without mutating the source records', () => {
    const downloads = [
      { id: '2', name: 'file-10.txt', size: 10, createdAt: 200 },
      { id: '1', name: 'File-2.txt', size: 30, createdAt: 100 },
      { id: '3', name: 'archive.zip', size: 20, createdAt: 300 }
    ]

    assert.deepEqual(
      sortBrowserDownloads(downloads, 'newest').map(({ id }) => id),
      ['3', '2', '1']
    )
    assert.deepEqual(
      sortBrowserDownloads(downloads, 'oldest').map(({ id }) => id),
      ['1', '2', '3']
    )
    assert.deepEqual(
      sortBrowserDownloads(downloads, 'name').map(({ id }) => id),
      ['3', '1', '2']
    )
    assert.deepEqual(
      sortBrowserDownloads(downloads, 'size').map(({ id }) => id),
      ['1', '3', '2']
    )
    assert.deepEqual(downloads.map(({ id }) => id), ['2', '1', '3'])
  })

  test('generates collision-free iOS destination names', () => {
    assert.equal(createUniqueDownloadFilename('report.pdf', []), 'report.pdf')
    assert.equal(
      createUniqueDownloadFilename('report.pdf', ['report.pdf', 'report (1).pdf']),
      'report (2).pdf'
    )
    assert.equal(createUniqueDownloadFilename('../unsafe.pdf', []), '.._unsafe.pdf')
  })

  test('keeps the browser downloads config plugin enabled', () => {
    const appConfig = JSON.parse(
      readFileSync(new URL('../../app.json', import.meta.url), 'utf8')
    )

    assert.equal(
      appConfig.expo.plugins.includes('./plugins/with-browser-downloads'),
      true
    )
  })

  test('generates and registers the Android download bridge idempotently', () => {
    const mainApplication = 'PackageList(this).packages.apply {\n        }'
    const registered = downloadsPlugin.addPackageRegistration(mainApplication)

    assert.match(registered, /add\(BrowserDownloadsPackage\(\)\)/)
    assert.equal(downloadsPlugin.addPackageRegistration(registered), registered)
    assert.match(
      downloadsPlugin.createDownloadsModule('xyz.test.browser'),
      /package xyz\.test\.browser/
    )
    assert.match(
      downloadsPlugin.createDownloadsModule('xyz.test.browser'),
      /fun openDownload\(id: String, promise: Promise\)/
    )
  })
})
