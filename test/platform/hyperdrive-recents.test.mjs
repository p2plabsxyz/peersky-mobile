import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  MAX_HYPERDRIVE_RECENTS,
  parseHyperdriveRecents,
  recordHyperdriveRecent,
  removeHyperdriveRecent,
  serializeHyperdriveRecents
} from '../../app/hyperdrive/recents.mjs'

const DRIVE_URL = `hyper://${'b'.repeat(64)}/`

test('constructs the recents file lazily inside protected storage operations', () => {
  const source = readFileSync(new URL('../../app/hyperdrive/recents-store.ts', import.meta.url), 'utf8')
  assert.match(source, /function getRecentsFile \(\)/)
  assert.doesNotMatch(source, /const RECENTS_FILE = new File/)
})

test('normalizes, deduplicates, and removes recent Hyper entries', () => {
  const first = recordHyperdriveRecent([], {
    type: 'file', name: 'Report', url: `${DRIVE_URL}report.pdf`, byteLength: 12, source: 'uploaded'
  }, 10)
  const updated = recordHyperdriveRecent(first, {
    type: 'file', name: 'Report updated', url: `${DRIVE_URL}report.pdf`, byteLength: 14
  }, 20)

  assert.equal(updated.length, 1)
  assert.equal(updated[0].name, 'Report updated')
  assert.equal(updated[0].source, 'fetched')
  assert.deepEqual(removeHyperdriveRecent(updated, `${DRIVE_URL}report.pdf`), [])
})

test('persists a bounded fetched directory snapshot for reopening without another listing', () => {
  const recents = recordHyperdriveRecent([], {
    type: 'directory',
    name: 'Photos',
    url: `${DRIVE_URL}photos/`,
    source: 'fetched',
    children: [{
      type: 'file',
      name: 'photo.jpg',
      url: `${DRIVE_URL}photos/photo.jpg`,
      byteLength: 42
    }]
  }, 10)

  const parsed = parseHyperdriveRecents(serializeHyperdriveRecents(recents))
  assert.equal(parsed[0].source, 'fetched')
  assert.deepEqual(parsed[0].children, [{
    type: 'file',
    name: 'photo.jpg',
    url: `${DRIVE_URL}photos/photo.jpg`,
    byteLength: 42
  }])
})

test('bounds cached directory snapshots across persisted recents', () => {
  const recents = Array.from({ length: 6 }, (_, index) => ({
    type: 'directory',
    name: `Folder ${index}`,
    url: `${DRIVE_URL}folder-${index}/`,
    source: 'fetched',
    openedAt: index + 1,
    children: [{
      type: 'file',
      name: 'file.txt',
      url: `${DRIVE_URL}folder-${index}/file.txt`
    }]
  })).reverse()

  const parsed = parseHyperdriveRecents(JSON.stringify(recents))
  assert.equal(parsed.filter((recent) => recent.children?.length).length, 5)
})

test('rejects malformed records and bounds persisted recent entries', () => {
  let recents = []
  for (let index = 0; index < MAX_HYPERDRIVE_RECENTS + 5; index++) {
    recents = recordHyperdriveRecent(recents, {
      type: 'file',
      name: `file-${index}`,
      url: `${DRIVE_URL}file-${index}.txt`
    }, index + 1)
  }

  assert.equal(recents.length, MAX_HYPERDRIVE_RECENTS)
  const parsed = parseHyperdriveRecents(serializeHyperdriveRecents(recents))
  assert.equal(parsed.length, MAX_HYPERDRIVE_RECENTS)
  assert.deepEqual(parseHyperdriveRecents('[{"type":"file","url":"https://example.com"}]'), [])
})

test('preserves filenames containing URL query and fragment characters', () => {
  const recents = recordHyperdriveRecent([], {
    type: 'file',
    name: 'report#2?.pdf',
    url: `${DRIVE_URL}report#2?.pdf`
  }, 10)

  assert.equal(recents[0].url, `${DRIVE_URL}report%232%3F.pdf`)
  assert.equal(parseHyperdriveRecents(serializeHyperdriveRecents(recents))[0].url,
    `${DRIVE_URL}report%232%3F.pdf`)
})

test('truncates recent names without splitting Unicode characters', () => {
  const expectedName = `${'a'.repeat(159)}😀`
  const recents = recordHyperdriveRecent([], {
    type: 'directory',
    name: `${expectedName}ignored`,
    url: `${DRIVE_URL}unicode/`,
    children: [{
      type: 'file',
      name: `${expectedName}ignored`,
      url: `${DRIVE_URL}unicode/file.txt`
    }]
  }, 10)

  assert.equal(recents[0].name, expectedName)
  assert.equal(recents[0].children[0].name, expectedName)
})

test('persists valid upload visibility while keeping legacy recents compatible', () => {
  const recents = [
    recordHyperdriveRecent([], {
      type: 'file',
      name: 'Private',
      url: `${DRIVE_URL}private.txt`,
      source: 'uploaded',
      visibility: 'private'
    }, 10)[0],
    recordHyperdriveRecent([], {
      type: 'file',
      name: 'Legacy',
      url: `${DRIVE_URL}legacy.txt`,
      source: 'uploaded'
    }, 20)[0]
  ]

  const parsed = parseHyperdriveRecents(serializeHyperdriveRecents(recents))
  assert.equal(parsed[0].visibility, 'private')
  assert.equal(parsed[1].visibility, undefined)
})
