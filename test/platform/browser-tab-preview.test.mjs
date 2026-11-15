import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import {
  getBrowserTabPreviewFilename,
  isBrowserTabPreviewFilename,
  isBrowserTabPreviewForPage,
  MAX_BROWSER_TAB_PREVIEW_FILE_BYTES,
  parseBrowserTabPreviewFilename,
  selectRetainedBrowserTabPreviewUris
} from '../../app/tabs/browser-tab-preview.mjs'

describe('browser tab preview cache helpers', () => {
  test('creates and parses a preview filename for the exact tab and page', () => {
    const filename = getBrowserTabPreviewFilename(
      'tab-7',
      'hyper://akhilesh.art/',
      123456,
      360,
      720
    )

    assert.equal(isBrowserTabPreviewFilename(filename), true)
    assert.deepEqual(
      parseBrowserTabPreviewFilename(filename, 'tab-7', 'hyper://akhilesh.art/'),
      {
        aspectRatio: 0.5,
        height: 720,
        revision: 123456,
        width: 360
      }
    )
    assert.equal(
      parseBrowserTabPreviewFilename(filename, 'tab-7', 'hyper://different/'),
      null
    )
  })

  test('rejects unsafe tab identifiers and invalid capture dimensions', () => {
    assert.equal(
      getBrowserTabPreviewFilename('../tab', 'https://example.com/', 1, 360, 720),
      null
    )
    assert.equal(
      getBrowserTabPreviewFilename('tab-1', 'https://example.com/', 1, 361, 720),
      null
    )
    assert.equal(
      getBrowserTabPreviewFilename('tab-1', 'https://example.com/', 1, 360, 721),
      null
    )
    assert.equal(
      getBrowserTabPreviewFilename('tab-1', 'https://example.com/', 0, 360, 720),
      null
    )
    assert.equal(isBrowserTabPreviewFilename('unrelated.jpg'), false)
  })

  test('matches previews only to their exact current page', () => {
    assert.equal(
      isBrowserTabPreviewForPage(
        'https://example.com/first',
        'https://example.com/first'
      ),
      true
    )
    assert.equal(
      isBrowserTabPreviewForPage(
        'https://example.com/first',
        'https://example.com/second'
      ),
      false
    )
    assert.equal(isBrowserTabPreviewForPage('', ''), false)
  })

  test('retains only bounded valid preview files within the total byte budget', () => {
    const first = getBrowserTabPreviewFilename(
      'tab-1',
      'https://example.com/first',
      1,
      360,
      720
    )
    const second = getBrowserTabPreviewFilename(
      'tab-2',
      'https://example.com/second',
      2,
      360,
      720
    )
    const retained = selectRetainedBrowserTabPreviewUris([
      {
        modificationTime: 1,
        name: first,
        size: 100,
        uri: 'file:///first.jpg'
      },
      {
        modificationTime: 2,
        name: second,
        size: 100,
        uri: 'file:///second.jpg'
      },
      {
        modificationTime: 3,
        name: 'invalid.jpg',
        size: 1,
        uri: 'file:///invalid.jpg'
      },
      {
        modificationTime: 4,
        name: first,
        size: MAX_BROWSER_TAB_PREVIEW_FILE_BYTES + 1,
        uri: 'file:///oversized.jpg'
      }
    ], 2, 150)

    assert.deepEqual([...retained], ['file:///second.jpg'])
  })

  test('keeps only the newest previews within the file-count limit', () => {
    const entries = Array.from({ length: 4 }, (_, index) => ({
      modificationTime: index + 1,
      name: getBrowserTabPreviewFilename(
        `tab-${index + 1}`,
        `https://example.com/${index + 1}`,
        index + 1,
        360,
        720
      ),
      size: 100,
      uri: `file:///${index + 1}.jpg`
    }))

    assert.deepEqual(
      [...selectRetainedBrowserTabPreviewUris(entries, 2, 1000)],
      ['file:///4.jpg', 'file:///3.jpg']
    )
  })
})

// A picture of the tab was taken while its page scrolled, about once a
// second. Drawing a page into a picture runs on the main thread, and on
// Android the median frame while scrolling Wikipedia was 33 ms, Chrome's 16.7.
describe('when a tab is pictured', () => {
  test('never while its page scrolls', async () => {
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(app, /onScroll=\{isKeyboardVisible \? onBrowserPageScroll : undefined\}/)
    const scroll = /function onBrowserPageScroll \(\) \{([\s\S]*?)\n {2}\}/.exec(app)?.[1] || ''
    assert.match(scroll, /Keyboard\.dismiss\(\)/)
    assert.doesNotMatch(scroll, /Preview/)
  })

  test('as the tab list opens and as a tab is left, while it is still in front', async () => {
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    // Both ways into the tab list picture the tab in front first.
    assert.equal(app.match(/onPress=\{openBrowserTabList\}|onOpenTabs=\{openBrowserTabList\}/g).length, 2)
    assert.doesNotMatch(app, /setBrowserTabsVisible\(true\)\s*\}\}/)
    assert.match(app, /function openBrowserTabList \(\) \{[^}]*captureBrowserTabPreview\(browserTabsStateRef\.current\.activeTabId\)\s*setBrowserTabsVisible\(true\)/)

    // Any change of the tab in front pictures the one going behind, before
    // the change is made.
    const update = /function updateBrowserTabsState \([\s\S]*?\n {2}\}\n/.exec(app)?.[0] || ''
    assert.match(update, /nextState\.activeTabId !== previousState\.activeTabId[\s\S]*captureBrowserTabPreview\(previousState\.activeTabId\)[\s\S]*browserTabsStateRef\.current = nextState/)
    assert.match(app, /canCapture: \(tabId\) => browserTabsStateRef\.current\.activeTabId === tabId/)

    // At once, not after a timer that would find the tab already behind.
    const hook = await readFile(new URL('../../app/tabs/useBrowserTabPreviews.ts', import.meta.url), 'utf8')
    assert.match(hook, /if \(wait === 0\) \{\s*captureTimersRef\.current\.delete\(tabId\)\s*void capturePreview\(tabId, pendingCapture\)\s*return\s*\}/)
    assert.match(hook, /\(canCaptureRef\.current && !canCaptureRef\.current\(tabId\)\)\s*\) return/)
  })
})
