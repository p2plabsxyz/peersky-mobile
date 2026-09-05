import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { describe, test } from 'node:test'

import { createBrowserContentBlockingScript } from '../../app/privacy/browserContentBlockingScript.mjs'
import { YOUTUBE_AD_BREAK_PATH } from '../../app/privacy/youtube-ad-blocking.mjs'

describe('YouTube ad blocking', () => {
  test('generates the pinned network guard without bundled scriptlets', () => {
    const script = createBrowserContentBlockingScript({
      youtubeAdBlockingEnabled: true
    })

    assert.match(script, /youtubei\/v1\/player\/ad_break/)
    assert.match(script, /youtube-nocookie[.]com/)
    assert.doesNotMatch(script, /ruleset: ublock-filters/)
    assert.ok(script.length < 10_000)
  })

  test('keeps YouTube protection independent from EasyList protection', async () => {
    const youtubeOnly = installContentBlockingScript({
      youtubeAdBlockingEnabled: true
    })
    await assert.rejects(
      youtubeOnly.window.fetch('https://www.youtube.com/youtubei/v1/player/ad_break'),
      /Failed to fetch/
    )
    assert.equal(
      await youtubeOnly.window.fetch('https://tracker.example/pixel'),
      'allowed'
    )
    assert.equal(youtubeOnly.bridgeCalls.length, 0)

    const easyListOnly = installContentBlockingScript({
      bridgeShouldBlock: url => url.includes('tracker.example'),
      enabled: true
    })
    await assert.rejects(
      easyListOnly.window.fetch('https://tracker.example/pixel'),
      /Failed to fetch/
    )
    assert.equal(
      await easyListOnly.window.fetch('https://www.youtube.com/youtubei/v1/player/ad_break'),
      'allowed'
    )
    assert.equal(easyListOnly.bridgeCalls.length, 2)

    assert.equal(createBrowserContentBlockingScript(), 'true')
  })

  test('uses only the pinned YouTube network path', () => {
    assert.equal(YOUTUBE_AD_BREAK_PATH, '/youtubei/v1/player/ad_break')
  })
})

function installContentBlockingScript ({
  bridgeShouldBlock = () => false,
  enabled = false,
  youtubeAdBlockingEnabled = false
} = {}) {
  const bridgeCalls = []
  class FakeXMLHttpRequest {
    open () {}
    send () {}
  }
  const window = {
    fetch: () => Promise.resolve('allowed'),
    XMLHttpRequest: FakeXMLHttpRequest,
    PeerSkyContentBlocker: {
      shouldBlock: (token, requestUrl) => {
        bridgeCalls.push({ token, requestUrl })
        return bridgeShouldBlock(requestUrl)
      }
    }
  }
  runInNewContext(createBrowserContentBlockingScript({
    bridgeToken: 'a'.repeat(32),
    enabled,
    youtubeAdBlockingEnabled
  }), {
    document: {
      baseURI: 'https://www.youtube.com/watch?v=1'
    },
    location: {
      href: 'https://www.youtube.com/watch?v=1'
    },
    setTimeout,
    URL,
    window
  })
  return { bridgeCalls, window }
}
