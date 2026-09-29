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

// Importing a playlist only ever stored the addresses, so the songs still came
// off the network every time. PeerSky already downloads a hyper folder when it
// is asked to; this is the page asking on the user's behalf.
test('a page can ask for a shared folder to be kept on the device', async () => {
  const { parsePeerTunesKeepOfflineRequest } = await import('../../app/peertunes/peertunes-screen.mjs')
  const ask = (url, requestId = 'keep-1') =>
    parsePeerTunesKeepOfflineRequest(JSON.stringify({ type: 'peertunes-keep-offline', requestId, url }))

  assert.deepEqual(ask('hyper://key/mix/'), { requestId: 'keep-1', url: 'hyper://key/mix/' })

  // Only a hyper folder: nothing else is something this can download, and the
  // request rides the same channel as a QR scan.
  assert.equal(ask('https://example.com/'), null)
  assert.equal(ask('file:///etc/passwd'), null)
  assert.equal(ask(''), null)
  assert.equal(ask('hyper://key/mix/', 'scan-1'), null)
  assert.equal(parsePeerTunesKeepOfflineRequest('{"type":"peertunes-haptic"}'), null)
})

test('the offer is only made where something can answer it', async () => {
  const { readFile } = await import('node:fs/promises')
  const ui = await readFile(new URL('../../assets/peertunes/js/ui.js', import.meta.url), 'utf8')
  const screen = await readFile(new URL('../../app/peertunes/PeerTunesScreen.tsx', import.meta.url), 'utf8')

  // No bridge, no row: PeerTunes runs outside PeerSky too.
  assert.match(ui, /if \(window\.peerskyKeepOffline && \/\^hyper:/)
  // And only for a playlist that came from a drive in the first place.
  assert.match(ui, /test\(p\.sourceUrl \|\| ""\)/)
  // Native answers with the same download the Hyperdrive screen starts.
  assert.match(screen, /await onKeepOffline\(url\)/)
})

// Whatever comes back rides into the page as a JavaScript literal, so it goes
// through the same escaping a scanned QR code does.
test('an answer with a line separator in it does not break the page', async () => {
  const { serializeScanResult } = await import('../../app/peertunes/peertunes-screen.mjs')
  const answer = { ok: false, error: 'no\u2028route' }

  const literal = serializeScanResult(answer)
  assert.doesNotMatch(literal, /\u2028|\u2029/)
  assert.deepEqual(JSON.parse(literal.replace(/\\u2028/g, '\u2028')), answer)

  const screen = await readFile(new URL('../../app/peertunes/PeerTunesScreen.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(screen, /JSON\.stringify\(answer\)/)
  assert.match(screen, /serializeScanResult\(answer\)/)
})
