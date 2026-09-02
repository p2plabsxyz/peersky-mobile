import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHyperUrl, parseHyperUrl } from '../../backend/hyper/url.mjs'

describe('hyper url parsing', () => {
  it('formats exact drive paths for hypercore-fetch', () => {
    const drive = `hyper://${'a'.repeat(64)}/`
    assert.equal(
      createHyperUrl(drive, '/one, two#three?.mp4'),
      `${drive}one,%20two%23three%3F.mp4`
    )
  })
  it('requires a string url', () => {
    assert.deepEqual(parseHyperUrl(), { error: 'Missing required "url"' })
    assert.deepEqual(parseHyperUrl(42), { error: 'Missing required "url"' })
  })

  it('rejects malformed urls and non-hyper protocols', () => {
    assert.deepEqual(parseHyperUrl('hyper://%'), { error: 'Invalid URL format' })
    assert.deepEqual(parseHyperUrl('https://example.com/'), { error: 'Only hyper:// URLs are supported' })
  })

  it('normalizes supported hyper urls', () => {
    assert.deepEqual(parseHyperUrl('hyper://example.com/'), {
      driveAddress: 'hyper://example.com/',
      pathname: '/'
    })

    assert.deepEqual(parseHyperUrl('hyper://example.com/docs/./intro.html'), {
      driveAddress: 'hyper://example.com/',
      pathname: '/docs/intro.html'
    })

    assert.deepEqual(parseHyperUrl('hyper://example.com/docs/'), {
      driveAddress: 'hyper://example.com/',
      pathname: '/docs/'
    })

    assert.deepEqual(parseHyperUrl('hyper://8fd6bna5d8t3p66eq917e144d1wrb3cxw4696y73ftj4qzjxwo7y/index.html'), {
      driveAddress: 'hyper://8fd6bna5d8t3p66eq917e144d1wrb3cxw4696y73ftj4qzjxwo7y/',
      pathname: '/index.html'
    })
  })

  it('rejects path traversal and unsafe path encodings', () => {
    assert.deepEqual(parseHyperUrl('hyper://example.com/%2e%2e/secrets'), {
      error: 'Path traversal is not allowed'
    })

    assert.deepEqual(parseHyperUrl('hyper://example.com/a/../secrets'), {
      error: 'Path traversal is not allowed'
    })

    assert.deepEqual(parseHyperUrl('hyper://example.com/a%5Cb'), {
      error: 'Invalid path separator'
    })

    assert.deepEqual(parseHyperUrl('hyper://example.com/%E0%A4%A'), {
      error: 'Invalid URL path encoding'
    })
  })
})
