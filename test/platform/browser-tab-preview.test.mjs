import assert from 'node:assert/strict'
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
