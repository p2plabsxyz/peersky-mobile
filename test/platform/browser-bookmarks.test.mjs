import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import {
  addBrowserBookmark,
  canBookmarkBrowserPage,
  isBrowserUrlBookmarked,
  MAX_BROWSER_BOOKMARKS,
  MAX_BROWSER_BOOKMARK_TITLE_LENGTH,
  parseBrowserBookmarks,
  removeBrowserBookmark,
  serializeBrowserBookmarks
} from '../../app/bookmarks/browser-bookmarks.mjs'
import { MAX_BROWSER_URL_LENGTH } from '../../app/browser-shell.mjs'
import {
  BROWSER_FAVICON_MESSAGE_TYPE,
  combineBrowserInjectedScripts,
  createBrowserFaviconScript,
  MAX_BROWSER_FAVICON_DATA_LENGTH,
  normalizeBrowserFavicon,
  parseBrowserFaviconMessage
} from '../../app/bookmarks/browser-favicon.mjs'

describe('browser bookmarks', () => {
  test('round-trips valid web and Hyper bookmarks', () => {
    const bookmarks = [
      {
        url: 'https://example.com/page',
        title: 'Example',
        createdAt: 10
      },
      {
        url: 'hyper://akhilesh.art/',
        title: 'Akhilesh',
        createdAt: 20
      }
    ]

    assert.deepEqual(
      parseBrowserBookmarks(serializeBrowserBookmarks(bookmarks)),
      bookmarks
    )
  })

  test('stores valid web and inlined Hyper favicons without requiring them', () => {
    const bookmarks = [
      {
        url: 'https://example.com/',
        title: 'Web page',
        createdAt: 1,
        favicon: 'https://example.com/favicon.ico'
      },
      {
        url: 'hyper://akhilesh.art/',
        title: 'Hyper page',
        createdAt: 2,
        favicon: 'data:image/png;base64,AAAA'
      }
    ]

    assert.deepEqual(
      parseBrowserBookmarks(serializeBrowserBookmarks(bookmarks)),
      bookmarks
    )
  })

  test('normalizes favicon messages and rejects unsafe or oversized icons', () => {
    assert.equal(
      normalizeBrowserFavicon('/favicon.ico', 'https://example.com/page'),
      'https://example.com/favicon.ico'
    )
    assert.equal(
      parseBrowserFaviconMessage(JSON.stringify({
        type: BROWSER_FAVICON_MESSAGE_TYPE,
        favicon: 'data:image/png;base64,AAAA'
      }), 'hyper://example/'),
      'data:image/png;base64,AAAA'
    )
    assert.equal(normalizeBrowserFavicon('javascript:alert(1)', 'https://example.com/'), null)
    assert.equal(
      normalizeBrowserFavicon(
        `data:image/png;base64,${'A'.repeat(MAX_BROWSER_FAVICON_DATA_LENGTH)}`,
        'hyper://example/'
      ),
      null
    )
    assert.equal(parseBrowserFaviconMessage('{"type":"other"}', 'https://example.com/'), undefined)
  })

  test('creates a bounded WebView favicon extraction script', () => {
    const script = createBrowserFaviconScript()

    assert.match(script, /ReactNativeWebView[.]postMessage/)
    assert.match(script, /favicon[.]ico/)
    assert.match(script, new RegExp(BROWSER_FAVICON_MESSAGE_TYPE))
    assert.match(script, new RegExp(String(MAX_BROWSER_FAVICON_DATA_LENGTH)))
  })

  test('separates injected scripts into valid JavaScript', () => {
    const script = combineBrowserInjectedScripts('(() => true)()', '(() => true)()')

    assert.doesNotThrow(() => new vm.Script(script))
    assert.match(script, /\(\);\n\(\(/)
  })

  test('rejects malformed, unsupported, credentialed, and duplicate entries', () => {
    const bookmarks = parseBrowserBookmarks({
      items: [
        { url: 'javascript:alert(1)', title: 'Unsafe', createdAt: 1 },
        { url: 'https://user:secret@example.com/', title: 'Credentials', createdAt: 2 },
        { url: 'not a url', title: 'Invalid', createdAt: 3 },
        { url: 'https://example.com/', title: 'First', createdAt: 4 },
        { url: 'https://example.com/', title: 'Duplicate', createdAt: 5 }
      ]
    })

    assert.deepEqual(bookmarks, [
      { url: 'https://example.com/', title: 'First', createdAt: 4 }
    ])
    assert.deepEqual(parseBrowserBookmarks('{invalid'), [])
  })

  test('rejects URLs that exceed the limit after canonicalization', () => {
    const rawUrl = `https://example.com/${'é'.repeat(Math.floor(MAX_BROWSER_URL_LENGTH / 2))}`

    assert.equal(rawUrl.length <= MAX_BROWSER_URL_LENGTH, true)
    assert.deepEqual(parseBrowserBookmarks({
      items: [{ url: rawUrl, title: 'Expanded URL', createdAt: 1 }]
    }), [])
  })

  test('caps inspected persisted entries', () => {
    const invalidItems = Array.from(
      { length: MAX_BROWSER_BOOKMARKS },
      (_, index) => ({ url: 'invalid', title: `Invalid ${index}`, createdAt: index })
    )

    assert.deepEqual(parseBrowserBookmarks({
      items: [
        ...invalidItems,
        { url: 'https://example.com/', title: 'Beyond limit', createdAt: 999 }
      ]
    }), [])
  })

  test('adds newest bookmarks first, updates duplicates, and preserves entries at the limit', () => {
    let bookmarks = []

    for (let index = 0; index < MAX_BROWSER_BOOKMARKS + 5; index += 1) {
      bookmarks = addBrowserBookmark(bookmarks, {
        url: `https://example.com/${index}`,
        title: `Page ${index}`,
        createdAt: index
      })
    }

    assert.equal(bookmarks.length, MAX_BROWSER_BOOKMARKS)
    assert.equal(bookmarks[0].url, `https://example.com/${MAX_BROWSER_BOOKMARKS - 1}`)
    assert.equal(bookmarks.at(-1).url, 'https://example.com/0')

    bookmarks = addBrowserBookmark(bookmarks, {
      url: bookmarks[5].url,
      title: 'Updated',
      createdAt: 999
    })

    assert.equal(bookmarks.length, MAX_BROWSER_BOOKMARKS)
    assert.equal(bookmarks[0].title, 'Updated')
    assert.equal(bookmarks[0].createdAt, 999)
  })

  test('normalizes titles without splitting Unicode characters', () => {
    const title = '😀'.repeat(MAX_BROWSER_BOOKMARK_TITLE_LENGTH + 2)
    const [bookmark] = addBrowserBookmark([], {
      url: 'https://example.com/',
      title,
      createdAt: 1
    })

    assert.equal(Array.from(bookmark.title).length, MAX_BROWSER_BOOKMARK_TITLE_LENGTH)
    assert.equal(bookmark.title.endsWith('😀'), true)
  })

  test('removes control and bidirectional formatting characters from titles', () => {
    const [bookmark] = addBrowserBookmark([], {
      url: 'https://example.com/',
      title: 'Safe\u0000\u200b\u202e\u2066Title',
      createdAt: 1
    })

    assert.equal(bookmark.title, 'SafeTitle')
  })

  test('removes and detects normalized bookmark URLs', () => {
    const bookmarks = addBrowserBookmark([], {
      url: 'https://example.com',
      title: 'Example',
      createdAt: 1
    })

    assert.equal(isBrowserUrlBookmarked(bookmarks, 'https://example.com/'), true)
    assert.deepEqual(removeBrowserBookmark(bookmarks, 'https://example.com'), [])
  })

  test('shows bookmark actions only for rendered website sources', () => {
    assert.equal(canBookmarkBrowserPage('web', 'https://example.com/'), true)
    assert.equal(canBookmarkBrowserPage('hyper', 'hyper://akhilesh.art/'), true)
    assert.equal(canBookmarkBrowserPage('home', 'peersky://home'), false)
    assert.equal(canBookmarkBrowserPage('app', 'peersky://p2p/p2pmd/'), false)
    assert.equal(canBookmarkBrowserPage('error', 'https://example.com/'), false)
    assert.equal(canBookmarkBrowserPage('restore', 'hyper://akhilesh.art/'), false)
  })
})
