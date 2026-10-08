import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import {
  BROWSER_LINK_ACTION_MESSAGE_TYPE,
  BROWSER_MEDIA_TOKEN_LENGTH,
  BROWSER_MEDIA_MESSAGE_TYPE,
  MAX_BROWSER_MEDIA_MESSAGE_LENGTH,
  MAX_BROWSER_MEDIA_TEXT_LENGTH,
  createBrowserMediaToken,
  createBrowserMediaLongPressScript,
  isDownloadableBrowserMediaUrl,
  parseBrowserLinkActionMessage,
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

  test('keeps a DOM fallback for native hit-test misses without disabling text selection', () => {
    const script = createBrowserMediaLongPressScript({ token: MEDIA_TOKEN })

    assert.match(script, /document[.]addEventListener\('contextmenu'/)
    assert.match(script, /event[.]isTrusted/)
    assert.match(script, /token: messageToken/)
    assert.match(script, /return false;/)
    assert.match(script, /event[.]preventDefault\(\)/)
    assert.match(script, /video[.]currentSrc/)
    assert.match(script, /else if \(image\)/)
    assert.match(script, /else if \(link\)/)
    assert.match(script, /image[.]currentSrc/)
    assert.match(script, /linkUrl/)
    assert.match(script, /providedToken !== messageToken/)
    assert.match(script, /document[.]elementsFromPoint/)
    assert.match(script, /parsed[.]username/)
    assert.match(script, /protocols[.]includes/)
    assert.doesNotMatch(script, /nativeHitTesting|setTimeout|setInterval/)
  })
})

// On iOS a held link showed the system's menu, whose Open Link went to Safari.
// The app's own menu sends what was picked from native code.
describe('iOS link menu', () => {
  const linkAction = (fields) => JSON.stringify({
    type: BROWSER_LINK_ACTION_MESSAGE_TYPE,
    token: MEDIA_TOKEN,
    ...fields
  })

  test('takes every action the menu has, for links the app opens', () => {
    for (const action of ['open', 'new-tab', 'background-tab', 'download', 'share']) {
      assert.deepEqual(
        parseBrowserLinkActionMessage(linkAction({ action, url: 'https://example.com/a' }), 'https://example.com/', MEDIA_TOKEN),
        { action, url: 'https://example.com/a' }
      )
    }
    assert.deepEqual(
      parseBrowserLinkActionMessage(linkAction({ action: 'open', url: 'hyper://example-key/page' }), '', MEDIA_TOKEN),
      { action: 'open', url: 'hyper://example-key/page' }
    )
    assert.deepEqual(
      parseBrowserLinkActionMessage(linkAction({ action: 'new-tab', url: 'peersky://p2p' }), '', MEDIA_TOKEN),
      { action: 'new-tab', url: 'peersky://p2p' }
    )
  })

  test('refuses other actions, other links, and a wrong or missing token', () => {
    const url = 'https://example.com/a'
    for (const message of [
      linkAction({ action: 'delete', url }),
      linkAction({ action: 'open', url: 'javascript:alert(1)' }),
      linkAction({ action: 'open', url: 'mailto:someone@example.com' }),
      linkAction({ action: 'open', url: 'file:///etc/hosts' }),
      linkAction({ action: 'open', url: 'https://user:secret@example.com/' }),
      linkAction({ action: 'open' }),
      linkAction({ action: 'open', url, token: 'b'.repeat(BROWSER_MEDIA_TOKEN_LENGTH) }),
      JSON.stringify({ type: BROWSER_MEDIA_MESSAGE_TYPE, token: MEDIA_TOKEN, action: 'open', url }),
      'not json',
      'x'.repeat(MAX_BROWSER_MEDIA_MESSAGE_LENGTH + 1)
    ]) {
      assert.equal(parseBrowserLinkActionMessage(message, '', MEDIA_TOKEN), null, message.slice(0, 120))
    }
    assert.equal(parseBrowserLinkActionMessage(linkAction({ action: 'open', url })), null)
  })

  test('the menu sends only what the app takes, with the tab token, from native code', async () => {
    const manager = await readFile(new URL('../../plugins/templates/PeerSkyWebViewManager.m.template', import.meta.url), 'utf8')
    assert.match(manager, new RegExp(`PeerSkyLinkActionMessageType = @"${BROWSER_LINK_ACTION_MESSAGE_TYPE}";`))
    assert.match(manager, /RCT_EXPORT_VIEW_PROPERTY\(mediaLongPressToken, NSString\)/)

    // A link the app opens always gets the app's menu: passing nil would
    // bring back the system's, with Open Link going to Safari.
    const menu = manager.slice(manager.indexOf('contextMenuConfigurationForElement:(WKContextMenuElementInfo *)'))
    assert.match(menu, /if \(!PeerSkyIsBrowserLink\(url\) \|\| !PeerSkyIsToken\(self\.mediaLongPressToken\)\) \{\s+completionHandler\(nil\);\s+return;\s+\}/)
    assert.match(menu, /completionHandler\(\[UIContextMenuConfiguration configurationWithIdentifier:nil previewProvider:nil actionProvider:/)
    assert.match(manager, /NSSet setWithArray:@\[ @"http", @"https", @"hyper", @"peersky" \]/)

    const sent = [...manager.matchAll(/linkAction\(@"[^"]+", @"[^"]+", @"([^"]+)"\)/g)].map((match) => match[1])
    assert.deepEqual(sent, ['new-tab', 'background-tab', 'download', 'share'])
    assert.match(manager, /\[animator addCompletion:\^\{\s+\[weakSelf sendLinkAction:@"open" url:url\];/)
    for (const action of [...sent, 'open']) {
      assert.ok(parseBrowserLinkActionMessage(linkAction({ action, url: 'https://example.com/' }), '', MEDIA_TOKEN), action)
    }

    // Straight to the app, never through the page.
    assert.match(manager, /if \(!self\.onMessage \|\| !PeerSkyIsToken\(token\)\) return;/)
    assert.match(manager, /NSMutableDictionary<NSString \*, id> \*event = \[self baseEvent\];\s+event\[@"data"\] = /)
    assert.doesNotMatch(menu.slice(0, menu.indexOf('@end')), /evaluateJavaScript/)

    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(app, /const linkAction = parseBrowserLinkActionMessage\(\s+event\.nativeEvent\.data,\s+pageUrl,\s+browserMediaToken\s+\)/)
    for (const action of [...sent, 'open']) assert.match(app, new RegExp(`action === '${action}'`))
  })
})
