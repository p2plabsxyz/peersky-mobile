import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
import { KNOWN_SITES } from '../../app/search/known-sites.mjs'

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
      { url: 'https://example.com/', title: 'Valid', visitedAt: 4 }
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
    assert.equal(revisited.length, 1)
    assert.equal(revisited[0].visitedAt, 2500)
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

  // Typing "youtube" offered the last video watched, not youtube.com.
  test('a site whose name starts with what was typed comes first, as its home page', () => {
    const items = [
      { url: 'https://www.youtube.com/watch?v=b', title: 'Second video', visitedAt: 9 },
      { url: 'https://duckduckgo.com/?q=youtube+music', title: 'youtube music at DuckDuckGo', visitedAt: 8 },
      { url: 'https://www.youtube.com/watch?v=a', title: 'First video', visitedAt: 7 },
      { url: 'https://www.youtube.com/', title: 'YouTube', visitedAt: 6 }
    ]
    assert.deepEqual(getBrowserHistorySuggestions(items, 'youtube').map((item) => item.url), [
      'https://www.youtube.com/',
      'https://www.youtube.com/watch?v=b',
      'https://www.youtube.com/watch?v=a',
      'https://duckduckgo.com/?q=youtube+music'
    ])
    assert.deepEqual(getBrowserHistorySuggestions(items, 'you')[0], { url: 'https://www.youtube.com/', title: 'YouTube', visitedAt: 9 })
    for (const typed of ['YouTube', 'youtube.com', 'youtube.com/', 'www.youtube', 'https://www.you']) {
      assert.equal(getBrowserHistorySuggestions(items, typed)[0].url, 'https://www.youtube.com/', typed)
    }
    // A path is past the site's name.
    assert.equal(getBrowserHistorySuggestions(items, 'youtube.com/watch')[0].url, 'https://www.youtube.com/watch?v=b')

    // YouTube on a phone.
    const phone = [
      { url: 'https://m.youtube.com/watch?v=wqaHXqadvb0', title: 'Yosemite in 4K', visitedAt: 3 },
      { url: 'https://mobile.de/cars', title: 'Cars', visitedAt: 2 }
    ]
    assert.deepEqual(getBrowserHistorySuggestions(phone, 'youtube')[0], { url: 'https://m.youtube.com/', title: 'youtube.com', visitedAt: 3 })
    assert.deepEqual(getBrowserHistorySuggestions(phone, 'mob')[0], { url: 'https://mobile.de/', title: 'mobile.de', visitedAt: 2 })

    // Last opened at m., but mostly at www: www is offered, and its home page
    // is not listed again further down.
    const mixed = [{ url: 'https://m.youtube.com/', title: 'YouTube', visitedAt: 10 }, ...items]
    assert.deepEqual(getBrowserHistorySuggestions(mixed, 'youtube').map((item) => item.url), [
      'https://www.youtube.com/',
      'https://www.youtube.com/watch?v=b',
      'https://www.youtube.com/watch?v=a',
      'https://duckduckgo.com/?q=youtube+music'
    ])
    assert.equal(getBrowserHistorySuggestions(mixed, 'youtube')[0].visitedAt, 10)
  })

  test('the site with more pages in history comes before the others, and a home never opened still shows', () => {
    const items = [
      { url: 'https://google.com/search?q=a', title: 'a', visitedAt: 5 },
      { url: 'https://github.com/p2plabsxyz/peersky-browser', title: 'peersky-browser', visitedAt: 4 },
      { url: 'http://github.com/p2plabsxyz', title: 'p2plabsxyz', visitedAt: 3 },
      { url: 'https://www.github.com/notifications', title: 'Notifications', visitedAt: 2 },
      { url: 'hyper://gardens.example/notes/', title: 'Notes', visitedAt: 1 }
    ]
    const found = getBrowserHistorySuggestions(items, 'g')
    assert.deepEqual(found.slice(0, 3), [
      // http, https and www are one site, shown as it was last opened.
      { url: 'https://github.com/', title: 'github.com', visitedAt: 4 },
      { url: 'https://google.com/', title: 'google.com', visitedAt: 5 },
      { url: 'hyper://gardens.example/', title: 'gardens.example', visitedAt: 1 }
    ])
    assert.equal(found.length, 5)
    assert.deepEqual(getBrowserHistorySuggestions(items, 'gardens').map((item) => item.url), [
      'hyper://gardens.example/',
      'hyper://gardens.example/notes/'
    ])
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

  // Typing "youtube" before YouTube was ever opened offered only searches, so
  // getting there took a search and then a tap on the result.
  test('offers a site from the list by name when history has none for it', () => {
    const youtube = { url: 'https://www.youtube.com/', title: 'YouTube', visitedAt: 0, known: true }
    for (const typed of ['youtube', 'YouTube', 'yo', 'youtube.com', 'www.youtube', 'https://you']) {
      assert.deepEqual(getBrowserHistorySuggestions([], typed)[0], youtube, typed)
    }
    // Other names it goes by, and the most used of two that fit.
    assert.equal(getBrowserHistorySuggestions([], 'twitter')[0].url, 'https://x.com/')
    assert.equal(getBrowserHistorySuggestions([], 'gmail')[0].url, 'https://mail.google.com/')
    assert.equal(getBrowserHistorySuggestions([], 'go')[0].url, 'https://www.google.com/')
    assert.equal(getBrowserHistorySuggestions([], 'flip')[0].url, 'https://www.flipkart.com/')

    // Not from one letter, a sentence, a path, a drive, or a name no site has.
    for (const typed of ['y', 'youtube music', 'youtube.com/watch', 'hyper://you', 'qqzzy']) {
      assert.equal(getBrowserHistorySuggestions([], typed).some((item) => item.known), false, typed)
    }

    // History's own site comes first, and the list does not add another.
    const visited = [{ url: 'https://www.yoga.example/', title: 'Yoga', visitedAt: 5 }]
    assert.deepEqual(getBrowserHistorySuggestions(visited, 'yo'), [visited[0]])
    const phone = [{ url: 'https://m.youtube.com/watch?v=a', title: 'A video', visitedAt: 4 }]
    assert.equal(getBrowserHistorySuggestions(phone, 'youtube')[0].url, 'https://m.youtube.com/')
    assert.equal(getBrowserHistorySuggestions(phone, 'youtube').some((item) => item.known), false)

    // Pages that match follow the site, within the five.
    const pages = Array.from({ length: 6 }, (_, index) => ({
      url: `https://example.com/youtube-${index}`, title: 'Notes', visitedAt: index
    }))
    const shown = getBrowserHistorySuggestions(pages, 'youtube')
    assert.equal(shown.length, 5)
    assert.equal(shown[0].known, true)
  })

  test('lists each site once, as an https home page with a name', () => {
    const urls = new Set()
    for (const site of KNOWN_SITES) {
      const url = new URL(site.url)
      assert.equal(url.protocol, 'https:', site.url)
      assert.equal(url.search + url.hash, '', site.url)
      assert.ok(site.name.trim(), site.url)
      assert.ok(!urls.has(site.url), site.url)
      urls.add(site.url)
      for (const name of site.also || []) assert.match(name, /^[a-z0-9.]+$/, site.url)
    }
  })

  test('marks a site from the list with a globe, not a clock', async () => {
    const source = await readFile(new URL('../../app/history/HistorySuggestions.tsx', import.meta.url), 'utf8')

    assert.match(source, /item\.known\s+\? <GlobeIcon/)
    assert.match(source, /item\.known\s+\? t\('Open \{name\}', \{ name: item\.title \}\)/)
  })
})
