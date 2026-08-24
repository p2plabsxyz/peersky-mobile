import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_HYPERDRIVE_RECENTS,
  parseHyperdriveRecents,
  recordHyperdriveRecent,
  removeHyperdriveRecent,
  serializeHyperdriveRecents
} from '../../app/hyperdrive/recents.mjs'

const DRIVE_URL = `hyper://${'b'.repeat(64)}/`

test('normalizes, deduplicates, and removes recent Hyper entries', () => {
  const first = recordHyperdriveRecent([], {
    type: 'file', name: 'Report', url: `${DRIVE_URL}report.pdf`, byteLength: 12
  }, 10)
  const updated = recordHyperdriveRecent(first, {
    type: 'file', name: 'Report updated', url: `${DRIVE_URL}report.pdf`, byteLength: 14
  }, 20)

  assert.equal(updated.length, 1)
  assert.equal(updated[0].name, 'Report updated')
  assert.deepEqual(removeHyperdriveRecent(updated, `${DRIVE_URL}report.pdf`), [])
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
