import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  addBrowserHistoryItem,
  getBrowserHistoryDocumentTitle,
  getBrowserHistorySuggestions,
  MAX_BROWSER_HISTORY_ITEMS,
  MAX_BROWSER_HISTORY_TITLE_LENGTH,
  mergeBrowserHistoryItems,
  parseBrowserHistory,
  parseBrowserHistoryResult,
  removeBrowserHistoryItem,
  serializeBrowserHistory
} from '../../app/history/browser-history.mjs'

describe('browser history', () => {
  test('round-trips valid web and Hyper visits', () => {
    const items = [
      { url: 'https://example.com/', title: 'Example', visitedAt: 2 },
      { url: 'hyper://akhilesh.art/', title: 'Akhilesh', visitedAt: 1 }
    ]

    assert.deepEqual(parseBrowserHistory(serializeBrowserHistory(items)), items)
  })

  test('rejects malformed, internal, credentialed, and unsafe entries', () => {
    assert.deepEqual(parseBrowserHistory({
      items: [
        { url: 'peersky://home', title: 'Home', visitedAt: 1 },
        { url: 'javascript:alert(1)', title: 'Unsafe', visitedAt: 2 },
        { url: 'https://user:secret@example.com/', title: 'Credentials', visitedAt: 3 },
        { url: 'https://example.com/', title: 'Valid', visitedAt: 4 },
        { url: 'https://example.com/', title: 'Duplicate', visitedAt: 5 }
      ]
    }), [
      { url: 'https://example.com/', title: 'Valid', visitedAt: 4 },
      { url: 'https://example.com/', title: 'Duplicate', visitedAt: 5 }
    ])
    assert.deepEqual(parseBrowserHistory('{invalid'), [])
    assert.equal(parseBrowserHistoryResult('{invalid').ok, false)
  })

  test('bounds visits and keeps the most recently visited URL first', () => {
    let items = []
    for (let index = 0; index < MAX_BROWSER_HISTORY_ITEMS + 5; index += 1) {
      items = addBrowserHistoryItem(items, {
        url: `https://example.com/${index}`,
        title: `Page ${index}`,
        visitedAt: index
      })
    }

    assert.equal(items.length, MAX_BROWSER_HISTORY_ITEMS)
    assert.equal(items[0].url, `https://example.com/${MAX_BROWSER_HISTORY_ITEMS + 4}`)
    assert.equal(items.at(-1).url, 'https://example.com/5')

    items = addBrowserHistoryItem(items, {
      url: 'https://example.com/10',
      title: 'Updated page',
      visitedAt: 1000
    })
    assert.equal(items[0].title, 'Updated page')
  })

  test('coalesces duplicate navigation callbacks within one second', () => {
    const initial = addBrowserHistoryItem([], {
      url: 'https://example.com/',
      title: 'Example',
      visitedAt: 1000
    })

    assert.equal(addBrowserHistoryItem(initial, {
      url: 'https://example.com/',
      title: 'Example',
      visitedAt: 1500
    }), initial)

    const revisited = addBrowserHistoryItem(initial, {
      url: 'https://example.com/',
      title: 'Example',
      visitedAt: 2500
    })
    assert.equal(revisited.length, 2)
  })

  test('matches suggestions by title or URL and respects the suggestion cap', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      url: `https://example.com/page-${index}`,
      title: `Example result ${index}`,
      visitedAt: index
    }))

    assert.equal(getBrowserHistorySuggestions(items, 'EXAMPLE').length, 5)
    assert.equal(getBrowserHistorySuggestions(items, 'page-7')[0].url, 'https://example.com/page-7')
    assert.deepEqual(getBrowserHistorySuggestions(items, '  '), [])

    const duplicates = [
      { url: 'https://example.com/', title: 'Newest', visitedAt: 2 },
      { url: 'https://example.com/', title: 'Older', visitedAt: 1 }
    ]
    assert.deepEqual(getBrowserHistorySuggestions(duplicates, 'example'), [duplicates[0]])
  })

  test('normalizes Unicode titles and removes formatting controls', () => {
    const [item] = addBrowserHistoryItem([], {
      url: 'https://example.com/',
      title: `${'😀'.repeat(MAX_BROWSER_HISTORY_TITLE_LENGTH + 2)}\u202e`,
      visitedAt: 1
    })

    assert.equal(Array.from(item.title).length, MAX_BROWSER_HISTORY_TITLE_LENGTH)
    assert.equal(item.title.endsWith('😀'), true)
  })

  test('removes normalized URLs', () => {
    const item = {
      url: 'https://example.com',
      title: 'Example',
      visitedAt: 1
    }
    const items = addBrowserHistoryItem([], item)

    assert.deepEqual(removeBrowserHistoryItem(items, item), [])
  })

  test('merges visits captured while persisted history is loading', () => {
    const restored = [{ url: 'https://old.example/', title: 'Old', visitedAt: 1 }]
    const pending = [
      { url: 'https://new.example/1', title: 'New 1', visitedAt: 2 },
      { url: 'https://new.example/2', title: 'New 2', visitedAt: 3 }
    ]

    assert.deepEqual(mergeBrowserHistoryItems(restored, pending), [
      pending[1],
      pending[0],
      restored[0]
    ])
  })

  test('extracts and normalizes Hyper document titles', () => {
    assert.equal(
      getBrowserHistoryDocumentTitle('<html><head><title>PeerSky &amp; Hyper</title></head></html>', 'hyper://site/'),
      'PeerSky & Hyper'
    )
    assert.equal(getBrowserHistoryDocumentTitle('<p>No title</p>', 'hyper://site/'), 'hyper://site/')
  })
})
