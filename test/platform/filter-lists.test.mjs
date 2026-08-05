import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  FILTER_LIST_SCHEMA_VERSION,
  FILTER_LIST_SOURCES,
  FILTER_LIST_UPDATE_INTERVAL_MS,
  MAX_FILTER_LIST_BYTES,
  MIN_FILTER_LIST_BYTES,
  getBoundedFilterListTransferLength,
  isSafeFilterListResponseUrl,
  parseFilterListState,
  serializeFilterListState,
  shouldUpdateFilterLists,
  validateFilterListSnapshot
} from '../../app/privacy/filter-lists.mjs'

function createState (updatedAt = 1_000) {
  return {
    schemaVersion: FILTER_LIST_SCHEMA_VERSION,
    updatedAt,
    snapshotName: `snapshot-${updatedAt}`,
    lists: FILTER_LIST_SOURCES.map((source) => ({
      id: source.id,
      url: source.url,
      filename: `${source.id}.txt`,
      byteLength: MIN_FILTER_LIST_BYTES
    }))
  }
}

describe('content-blocking filter lists', () => {
  test('uses only the maintained HTTPS EasyList sources', () => {
    assert.deepEqual(
      FILTER_LIST_SOURCES.map(({ id }) => id),
      ['easylist', 'easyprivacy']
    )
    assert.equal(FILTER_LIST_SOURCES.every(({ url }) => url.startsWith('https://')), true)
  })

  test('updates missing, expired, and future-dated snapshots', () => {
    assert.equal(shouldUpdateFilterLists(null, 1_000), true)
    assert.equal(shouldUpdateFilterLists(createState(1_000), 1_001), false)
    assert.equal(
      shouldUpdateFilterLists(createState(1_000), 1_000 + FILTER_LIST_UPDATE_INTERVAL_MS),
      true
    )
    assert.equal(shouldUpdateFilterLists(createState(2_000), 1_000), true)
  })

  test('validates Adblock list headers and bounded sizes', () => {
    assert.deepEqual(validateFilterListSnapshot({
      id: 'easylist',
      byteLength: MIN_FILTER_LIST_BYTES,
      preamble: '[Adblock Plus 2.0]\n! Title: EasyList'
    }), { ok: true })
    assert.equal(validateFilterListSnapshot({
      id: 'unknown',
      byteLength: MIN_FILTER_LIST_BYTES,
      preamble: '[Adblock Plus 2.0]'
    }).ok, false)
    assert.equal(validateFilterListSnapshot({
      id: 'easylist',
      byteLength: MAX_FILTER_LIST_BYTES + 1,
      preamble: '[Adblock Plus 2.0]'
    }).ok, false)
    assert.equal(validateFilterListSnapshot({
      id: 'easylist',
      byteLength: MIN_FILTER_LIST_BYTES,
      preamble: '<html>upstream error</html>'
    }).ok, false)
  })

  test('accepts byte order marks before a valid filter-list header', () => {
    assert.equal(validateFilterListSnapshot({
      id: 'easylist',
      byteLength: MIN_FILTER_LIST_BYTES,
      preamble: '\uFEFF[Adblock Plus 2.0]'
    }).ok, true)
    assert.equal(validateFilterListSnapshot({
      id: 'easyprivacy',
      byteLength: MIN_FILTER_LIST_BYTES,
      preamble: '\u00EF\u00BB\u00BF[Adblock Plus 2.0]'
    }).ok, true)
  })

  test('rejects redirects outside credential-free HTTPS URLs', () => {
    const sourceUrl = FILTER_LIST_SOURCES[0].url

    assert.equal(isSafeFilterListResponseUrl('', sourceUrl), true)
    assert.equal(isSafeFilterListResponseUrl('https://cdn.example/list.txt', sourceUrl), true)
    assert.equal(isSafeFilterListResponseUrl('http://cdn.example/list.txt', sourceUrl), false)
    assert.equal(isSafeFilterListResponseUrl('https://user:secret@cdn.example/list.txt', sourceUrl), false)
    assert.equal(isSafeFilterListResponseUrl('not a URL', sourceUrl), false)
  })

  test('accepts only bounded filter-list transfers', () => {
    assert.equal(getBoundedFilterListTransferLength({
      status: 200,
      contentLength: '4096',
      contentRange: null
    }), 4096)
    assert.equal(getBoundedFilterListTransferLength({
      status: 206,
      contentLength: null,
      contentRange: 'bytes 0-4095/4096'
    }), 4096)
    assert.equal(getBoundedFilterListTransferLength({
      status: 200,
      contentLength: null,
      contentRange: null
    }), null)
    assert.equal(getBoundedFilterListTransferLength({
      status: 206,
      contentLength: null,
      contentRange: `bytes 0-${MAX_FILTER_LIST_BYTES}/${MAX_FILTER_LIST_BYTES + 1}`
    }), null)
    assert.equal(getBoundedFilterListTransferLength({
      status: 206,
      contentLength: '12',
      contentRange: 'bytes 0-4095/4096'
    }), null)
  })

  test('round trips valid state in canonical source order', () => {
    const state = createState()
    state.lists.reverse()

    const parsed = parseFilterListState(serializeFilterListState(state))

    assert.deepEqual(parsed?.lists.map(({ id }) => id), ['easylist', 'easyprivacy'])
  })

  test('rejects stale schemas, unsafe paths, duplicate sources, and altered URLs', () => {
    assert.equal(parseFilterListState({ ...createState(), schemaVersion: 2 }), null)
    assert.equal(parseFilterListState({ ...createState(), snapshotName: '../snapshot-1' }), null)

    const duplicate = createState()
    duplicate.lists[1] = { ...duplicate.lists[0] }
    assert.equal(parseFilterListState(duplicate), null)

    const alteredUrl = createState()
    alteredUrl.lists[0].url = 'https://example.com/list.txt'
    assert.equal(parseFilterListState(alteredUrl), null)
    assert.equal(parseFilterListState('{broken'), null)
  })
})
