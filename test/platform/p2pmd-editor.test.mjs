import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createP2pmdEditorUrl,
  createP2pmdNonce,
  getP2pmdEditorRequestAction,
  isP2pmdEditorMessage
} from '../../app/p2pmd-editor.mjs'

const NONCE = createP2pmdNonce(new Uint8Array(16).fill(171))
const EDITOR = createP2pmdEditorUrl('http://127.0.0.1:53111/', 'client', NONCE)

test('the editor address carries the role and a nonce', () => {
  const url = new URL(EDITOR)
  assert.equal(url.origin, 'http://127.0.0.1:53111')
  assert.equal(url.pathname, '/')
  assert.equal(url.searchParams.get('role'), 'client')
  assert.equal(url.searchParams.get('editor'), 'ab'.repeat(16))
  assert.equal(new URL(createP2pmdEditorUrl('http://127.0.0.1:1', 'host', NONCE)).searchParams.get('role'), 'host')
  assert.equal(new URL(createP2pmdEditorUrl('http://127.0.0.1:1', 'admin', NONCE)).searchParams.get('role'), 'client')
  assert.throws(() => createP2pmdNonce(new Uint8Array(8)))
})

test('only the editor itself loads in the editor', () => {
  assert.equal(getP2pmdEditorRequestAction({ url: EDITOR }, EDITOR), 'load')
  assert.equal(getP2pmdEditorRequestAction({ url: `${EDITOR}#ieee-ref-1` }, EDITOR), 'load')
  assert.equal(getP2pmdEditorRequestAction({ url: 'about:blank' }, EDITOR), 'load')

  // The room's server answers at the same origin. Without the nonce, a link
  // to it would have put the room host's page where the editor was.
  for (const url of [
    'http://127.0.0.1:53111/',
    'http://127.0.0.1:53111/?role=client',
    'http://127.0.0.1:53111/?role=client#x',
    'http://127.0.0.1:53111/lib/yjs.min.js'
  ]) {
    assert.equal(getP2pmdEditorRequestAction({ url }, EDITOR), 'open', url)
  }
})

test('links go to a browser tab and other apps are never opened from a note', () => {
  assert.equal(getP2pmdEditorRequestAction({ url: 'https://example.com/' }, EDITOR), 'open')
  assert.equal(getP2pmdEditorRequestAction({ url: `hyper://${'a'.repeat(52)}/` }, EDITOR), 'open')
  for (const url of [
    'peersky://p2p/peerchat/#room=abc',
    'intent://scan/#Intent;scheme=zxing;end',
    'javascript:alert(1)',
    'mailto:someone@example.com',
    'tel:123',
    'not a url'
  ]) {
    assert.equal(getP2pmdEditorRequestAction({ url }, EDITOR), 'block', url)
  }
  assert.equal(getP2pmdEditorRequestAction({ url: EDITOR, isTopFrame: false }, EDITOR), 'block')
  assert.equal(getP2pmdEditorRequestAction({ url: 'https://example.com/', isTopFrame: false }, EDITOR), 'block')
})

test('messages count only from the editor page', () => {
  assert.equal(isP2pmdEditorMessage(EDITOR, EDITOR), true)
  assert.equal(isP2pmdEditorMessage(`${EDITOR}#ieee-ref-2`, EDITOR), true)
  // Android WebViews too old for message listeners say about:blank.
  assert.equal(isP2pmdEditorMessage('about:blank', EDITOR), true)
  assert.equal(isP2pmdEditorMessage('', EDITOR), true)
  // The rest of Android names only the origin. Turning that away dropped every
  // message from the editor: no preview, no publish, no status.
  assert.equal(isP2pmdEditorMessage('http://127.0.0.1:53111', EDITOR), true)
  assert.equal(isP2pmdEditorMessage('http://127.0.0.1:53112', EDITOR), false)
  assert.equal(isP2pmdEditorMessage('http://localhost:53111', EDITOR), false)
  assert.equal(isP2pmdEditorMessage('null', EDITOR), false)
  assert.equal(isP2pmdEditorMessage('http://127.0.0.1:53111/?role=client', EDITOR), false)
  assert.equal(isP2pmdEditorMessage('https://example.com/', EDITOR), false)
  assert.equal(isP2pmdEditorMessage('https://example.com', EDITOR), false)
  assert.equal(isP2pmdEditorMessage('http://127.0.0.1:53111', 'not a url'), false)
})

// react-native-webview hands Android messages to a WebMessageListener, whose
// only word on where a message came from is the sender's origin.
test('Android names the origin a message came from, not the page', async () => {
  const { readFile } = await import('node:fs/promises')
  const webview = await readFile(new URL('../../node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java', import.meta.url), 'utf8')
  assert.match(webview, /RNCWebView\.this\.onMessage\(message\.getData\(\), sourceOrigin\.toString\(\)\)/)
})
