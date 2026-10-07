import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHyperUrl, parseHyperUrl, toHyperFetchUrl } from '../../backend/hyper/url.mjs'

describe('hyper url parsing', () => {
  it('formats exact drive paths for hypercore-fetch', () => {
    const drive = `hyper://${'a'.repeat(64)}/`
    assert.equal(
      createHyperUrl(drive, '/one, two#three?.mp4'),
      `${drive}one,%20two%23three%3F.mp4`
    )
  })

  // A song named "Safe & Sound" would not play in PeerTunes on the phone: the
  // page escaped the & as %26, and hypercore-fetch's decodeURI kept it.
  it('respells a page address so hypercore-fetch finds the file', () => {
    const drive = `hyper://${'a'.repeat(64)}/`
    const song = toHyperFetchUrl(`${drive}music/05%20-%20Safe%20%26%20Sound.mp3`)
    assert.equal(song, `${drive}music/05%20-%20Safe%20&%20Sound.mp3`)
    assert.equal(decodeURI(new URL(song).pathname), '/music/05 - Safe & Sound.mp3')
    assert.equal(decodeURI(new URL(toHyperFetchUrl(`${drive}a%2Cb%3Bc%3Dd%2Be.png`)).pathname), '/a,b;c=d+e.png')
    assert.equal(toHyperFetchUrl(`${drive}what%3F%23.mp3`), `${drive}what%3F%23.mp3`)
    assert.equal(toHyperFetchUrl(`${drive}?key=x`), `${drive}?key=x`)
    assert.equal(toHyperFetchUrl('hyper://%'), 'hyper://%')
    assert.equal(toHyperFetchUrl('https://example.com/a%26b'), 'https://example.com/a%26b')
  })

  it('reads media and PeerTunes songs through the respelled address', async () => {
    const fetch = await readFile(new URL('../../backend/hyper/fetch.mjs', import.meta.url), 'utf8')
    assert.match(fetch, /export function routedHyperFetch \(url, options\) \{[\s\S]{0,200}return fetch\(toHyperFetchUrl\(url\), options\)/)
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
