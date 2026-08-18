import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  BROWSER_MEDIA_TOKEN_LENGTH,
  BROWSER_MEDIA_MESSAGE_TYPE,
  MAX_BROWSER_MEDIA_MESSAGE_LENGTH,
  MAX_BROWSER_MEDIA_TEXT_LENGTH,
  createBrowserMediaToken,
  createBrowserMediaLongPressScript,
  isDownloadableBrowserMediaUrl,
  parseBrowserMediaMessage
} from '../../app/browser-media.mjs'

const MEDIA_TOKEN = 'a'.repeat(BROWSER_MEDIA_TOKEN_LENGTH)

describe('browser media long press', () => {
  test('normalizes a linked image target without losing either URL', () => {
    const target = parseBrowserMediaMessage(JSON.stringify({
      type: BROWSER_MEDIA_MESSAGE_TYPE,
      token: MEDIA_TOKEN,
      kind: 'image',
      mediaUrl: '/images/photo.jpg',
      linkUrl: '/article',
      title: '  Photo\n title  '
    }), 'https://example.com/posts/1', MEDIA_TOKEN)

    assert.deepEqual(target, {
      kind: 'image',
      mediaUrl: 'https://example.com/images/photo.jpg',
      linkUrl: 'https://example.com/article',
      title: 'Photo title'
    })
  })

  test('accepts browser links while restricting downloadable media to HTTP', () => {
    assert.equal(parseBrowserMediaMessage(JSON.stringify({
      type: BROWSER_MEDIA_MESSAGE_TYPE,
      token: MEDIA_TOKEN,
      kind: 'link',
      linkUrl: 'hyper://example-key/page'
    }), '', MEDIA_TOKEN)?.linkUrl, 'hyper://example-key/page')
    assert.equal(isDownloadableBrowserMediaUrl('https://example.com/file.png'), true)
    assert.equal(isDownloadableBrowserMediaUrl('hyper://example-key/file.png'), false)
  })

  test('rejects unsafe, credentialed, malformed, and incomplete targets', () => {
    const messages = [
      { kind: 'image', mediaUrl: 'data:image/png;base64,AAAA' },
      { kind: 'video', mediaUrl: 'file:///private/video.mp4' },
      { kind: 'link', linkUrl: 'javascript:alert(1)' },
      { kind: 'link', linkUrl: 'https://user:secret@example.com/' },
      { kind: 'image', mediaUrl: 'https://example.com/\u0000bad.png' },
      { kind: 'image', linkUrl: 'https://example.com/' }
    ]

    messages.forEach((target) => {
      assert.equal(parseBrowserMediaMessage(JSON.stringify({
        type: BROWSER_MEDIA_MESSAGE_TYPE,
        token: MEDIA_TOKEN,
        ...target
      }), '', MEDIA_TOKEN), null)
    })
    assert.equal(parseBrowserMediaMessage('{not-json', '', MEDIA_TOKEN), null)
    assert.equal(
      parseBrowserMediaMessage('x'.repeat(MAX_BROWSER_MEDIA_MESSAGE_LENGTH + 1), '', MEDIA_TOKEN),
      null
    )
  })

  test('bounds target text without splitting Unicode characters', () => {
    const emoji = '\u{1F600}'
    const title = `${'a'.repeat(MAX_BROWSER_MEDIA_TEXT_LENGTH - 1)}${emoji}tail`
    const target = parseBrowserMediaMessage(JSON.stringify({
      type: BROWSER_MEDIA_MESSAGE_TYPE,
      token: MEDIA_TOKEN,
      kind: 'image',
      mediaUrl: 'https://example.com/photo.jpg',
      title
    }), '', MEDIA_TOKEN)

    assert.equal(Array.from(target.title).length, MAX_BROWSER_MEDIA_TEXT_LENGTH)
    assert.equal(target.title.endsWith(emoji), true)
  })

  test('rejects missing and mismatched authorization tokens', () => {
    const message = {
      type: BROWSER_MEDIA_MESSAGE_TYPE,
      token: MEDIA_TOKEN,
      kind: 'image',
      mediaUrl: 'https://example.com/photo.jpg'
    }

    assert.equal(parseBrowserMediaMessage(JSON.stringify(message)), null)
    assert.equal(
      parseBrowserMediaMessage(JSON.stringify(message), '', 'b'.repeat(BROWSER_MEDIA_TOKEN_LENGTH)),
      null
    )
  })

  test('creates bounded lowercase hexadecimal authorization tokens', () => {
    const token = createBrowserMediaToken(Uint8Array.from({ length: 16 }, (_, index) => index))

    assert.equal(token.length, BROWSER_MEDIA_TOKEN_LENGTH)
    assert.match(token, /^[a-f0-9]+$/)
    assert.equal(token, '000102030405060708090a0b0c0d0e0f')
  })

  test('uses the native Android path without disabling normal text selection', () => {
    const nativeScript = createBrowserMediaLongPressScript({
      nativeHitTesting: true,
      token: MEDIA_TOKEN
    })
    const webKitScript = createBrowserMediaLongPressScript({ token: MEDIA_TOKEN })

    assert.match(nativeScript, /nativeHitTesting = true/)
    assert.match(nativeScript, /document[.]addEventListener\('contextmenu'/)
    assert.match(nativeScript, /event[.]isTrusted/)
    assert.match(nativeScript, /token: messageToken/)
    assert.match(nativeScript, /if \(!kind\) return;/)
    assert.match(nativeScript, /event[.]preventDefault\(\)/)
    assert.match(nativeScript, /video[.]currentSrc/)
    assert.match(webKitScript, /image[.]currentSrc/)
    assert.match(webKitScript, /linkUrl/)
    assert.match(webKitScript, /parsed[.]username/)
    assert.match(webKitScript, /protocols[.]includes/)
    assert.doesNotMatch(webKitScript, /setTimeout|setInterval/)
  })
})
