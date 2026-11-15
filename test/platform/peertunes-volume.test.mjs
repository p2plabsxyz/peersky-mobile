import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

import {
  PEERTUNES_SCAN_BRIDGE_SCRIPT,
  PEERTUNES_VOLUME_BRIDGE_SCRIPT,
  createPeerTunesVolumeAnswerScript,
  parsePeerTunesVolumeRequest
} from '../../app/peertunes/peertunes-screen.mjs'

// iOS plays a song in a WebView at full volume whatever the page sets, so
// turning PeerTunes' wheel on Now Playing did nothing while a song played. On
// iOS the page asks native to move the phone's own volume instead.

// The bridge as the page runs it, with a native side the test answers for.
function page () {
  const sent = []
  const timers = []
  const window = {
    ReactNativeWebView: { postMessage: (message) => sent.push(JSON.parse(message)) }
  }
  vm.runInNewContext(PEERTUNES_VOLUME_BRIDGE_SCRIPT, {
    window,
    JSON,
    Number,
    Promise,
    setTimeout: (fn, ms) => timers.push({ fn, ms })
  })
  const answer = (requestId, volume) => vm.runInNewContext(createPeerTunesVolumeAnswerScript(requestId, volume), { window })
  return { window, sent, timers, answer }
}

test('a turn of the wheel asks native to move the volume, and gets where it is now', async () => {
  const { window, sent, answer } = page()
  const turned = window.peerskyVolume.change(-0.05)
  assert.deepEqual(sent, [{ type: 'peertunes-volume', requestId: 'volume-1', step: -0.05 }])
  answer('volume-1', 0.45)
  assert.deepEqual({ ...(await turned) }, { volume: 0.45 })
})

test('no volume to set reads as none, and an answer that never comes too', async () => {
  const { window, timers, answer } = page()
  const simulator = window.peerskyVolume.change(0.05)
  answer('volume-1', null)
  assert.equal(await simulator, null)

  const lost = window.peerskyVolume.change(0.05)
  assert.equal(timers.at(-1).ms, 2000)
  timers.at(-1).fn()
  assert.equal(await lost, null)
  // A late answer for it changes nothing.
  answer('volume-2', 0.9)
})

test('the answer is held between 0 and 1, and only a number counts', () => {
  assert.match(createPeerTunesVolumeAnswerScript('volume-3', 1.7), /\{"volume":1\}/)
  assert.match(createPeerTunesVolumeAnswerScript('volume-3', -2), /\{"volume":0\}/)
  for (const volume of [null, undefined, NaN, '0.5']) {
    assert.match(createPeerTunesVolumeAnswerScript('volume-3', volume), /\("volume-3", null\)/)
  }
})

test('only a well formed volume request is read as one', () => {
  assert.deepEqual(parsePeerTunesVolumeRequest('{"type":"peertunes-volume","requestId":"volume-7","step":0.05}'), { requestId: 'volume-7', step: 0.05 })
  assert.deepEqual(parsePeerTunesVolumeRequest('{"type":"peertunes-volume","requestId":"volume-7","step":9}'), { requestId: 'volume-7', step: 1 })
  for (const raw of [
    '{"type":"peertunes-volume","requestId":"volume-7","step":"loud"}',
    '{"type":"peertunes-volume","requestId":"scan-7","step":0.05}',
    '{"type":"peertunes-volume","requestId":"volume-7\\");alert(1);(\\"","step":0.05}',
    '{"type":"peertunes-haptic","weight":"light"}',
    'not json',
    ''
  ]) {
    assert.equal(parsePeerTunesVolumeRequest(raw), null, raw)
  }
})

test('the volume bridge goes in on iOS only, where the song volume is fixed', async () => {
  const screen = await readFile(new URL('../../app/peertunes/PeerTunesScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /Platform\.OS === 'ios' \? PEERTUNES_VOLUME_BRIDGE_SCRIPT : ''/)
  assert.doesNotMatch(PEERTUNES_SCAN_BRIDGE_SCRIPT, /peerskyVolume/)
  assert.match(screen, /const volume = parsePeerTunesVolumeRequest\(event\.nativeEvent\.data\)/)
  assert.match(screen, /volume = \(await audioRoute\?\.changeVolume\?\.\(step\)\) \?\? null/)
  assert.match(screen, /injectJavaScript\(createPeerTunesVolumeAnswerScript\(requestId, volume\)\)/)
})

test('native moves the volume through a volume view out of sight, and gives none without a slider', async () => {
  const native = await readFile(new URL('../../plugins/templates/PeerSkyAudioRoute.m.template', import.meta.url), 'utf8')
  assert.match(native, /#import <MediaPlayer\/MediaPlayer\.h>/)
  assert.match(native, /RCT_EXPORT_METHOD\(changeVolume:\(double\)step/)
  assert.match(native, /if \(!slider\) \{\n\s+resolve\(\[NSNull null\]\);/)
  // From the system's reading, or from what it set a moment ago, never from a
  // slider that has not caught up.
  assert.match(native, /: \[AVAudioSession sharedInstance\]\.outputVolume;/)
  assert.match(native, /float to = MIN\(1\.0f, MAX\(0\.0f, from \+ \(float\)step\)\);/)
  assert.match(native, /if \(step == 0\) return from;/)
  assert.match(native, /initWithFrame:CGRectMake\(-2000, -2000, 160, 40\)/)
  // The side buttons get their volume pill back once the wheel stops.
  assert.match(native, /if \(turn == self->_volumeTurns\) \[self->_volumeView removeFromSuperview\];/)
})

test('PeerTunes on the phone turns the volume through the player', async () => {
  const player = await readFile(new URL('../../assets/peertunes/js/player.js', import.meta.url), 'utf8')
  const ui = await readFile(new URL('../../assets/peertunes/js/ui.js', import.meta.url), 'utf8')
  assert.match(player, /stepVolume\(delta\) \{/)
  assert.match(player, /window\.peerskyVolume/)
  assert.match(ui, /ui\.player\.stepVolume\(dir \* 0\.05\);/)
  const runtime = await readFile(new URL('../../backend/peertunes/peertunes-runtime.mjs', import.meta.url), 'utf8')
  assert.ok(runtime.includes('stepVolume'), 'the runtime the app serves has it too')
})
