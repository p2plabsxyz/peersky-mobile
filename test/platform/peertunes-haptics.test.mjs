import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  PEERTUNES_SCAN_BRIDGE_SCRIPT,
  parsePeerTunesHapticRequest
} from '../../app/peertunes/peertunes-screen.mjs'

// A page inside a WebView cannot reach the taptic engine, so it asks for one.
test('a haptic request carries the weight the page asked for', () => {
  assert.equal(parsePeerTunesHapticRequest('{"type":"peertunes-haptic","weight":"medium"}'), 'medium')
  assert.equal(parsePeerTunesHapticRequest('{"type":"peertunes-haptic","weight":"heavy"}'), 'heavy')
  // Anything unrecognised is the lightest one. A buzz is not worth an error.
  assert.equal(parsePeerTunesHapticRequest('{"type":"peertunes-haptic"}'), 'light')
  assert.equal(parsePeerTunesHapticRequest('{"type":"peertunes-haptic","weight":"enormous"}'), 'light')
})

test('nothing else is read as a haptic request', () => {
  assert.equal(parsePeerTunesHapticRequest('{"type":"peertunes-scan-qr","requestId":"scan-1"}'), null)
  assert.equal(parsePeerTunesHapticRequest('not json'), null)
  assert.equal(parsePeerTunesHapticRequest(''), null)
  assert.equal(parsePeerTunesHapticRequest(null), null)
})

test('the page is given a way to ask', () => {
  assert.match(PEERTUNES_SCAN_BRIDGE_SCRIPT, /window\.peerskyHaptic = function \(weight\)/)
  // It says whether the ask landed, so the page can fall back to the web API
  // when it is running outside PeerSky.
  assert.match(PEERTUNES_SCAN_BRIDGE_SCRIPT, /if \(!window\.ReactNativeWebView\) return false;/)
})

// A WebView inside a display:none view has its media suspended by the platform,
// which silenced the music the moment you switched tab.
test('PeerTunes stays attached when another tab is in front', async () => {
  const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')

  const layer = index.slice(index.indexOf('{peertunesMounted && ('), index.indexOf('<PeerTunesScreen'))
  assert.match(layer, /styles\.browserWebViewLayerOffscreen/)
  assert.doesNotMatch(layer, /browserWebViewLayerHidden/)

  const offscreen = styles.slice(styles.indexOf('browserWebViewLayerOffscreen: {'), styles.indexOf('browserWebView: {'))
  assert.doesNotMatch(offscreen, /display: 'none'/)
  assert.match(offscreen, /left: -20000/)
})
