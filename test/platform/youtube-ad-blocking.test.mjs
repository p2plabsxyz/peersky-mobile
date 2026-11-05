import assert from 'node:assert/strict'
import vm, { runInNewContext } from 'node:vm'
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

  test('takes the ads out of the data a YouTube page starts with', () => {
    const page = openPage('https://m.youtube.com/watch?v=1')

    // What the page's own inline scripts set, after this script ran.
    page.window.ytInitialPlayerResponse = playerResponse()
    page.window.ytInitialData = feed()

    assert.deepEqual(Object.keys(page.window.ytInitialPlayerResponse), ['videoDetails', 'streamingData'])
    assert.deepEqual(videosIn(page.window.ytInitialData), ['a', 'b'])
  })

  test('takes the ads out of what a YouTube page fetches as it moves on', () => {
    const page = openPage('https://www.youtube.com/watch?v=1')
    // The next video comes as one response for the player and one for the
    // page around it, read with JSON.parse.
    const next = page.parse(JSON.stringify([
      { playerResponse: playerResponse() },
      { watchNextResponse: feed() }
    ]))

    assert.deepEqual(Object.keys(next[0].playerResponse), ['videoDetails', 'streamingData'])
    assert.deepEqual(videosIn(next[1].watchNextResponse), ['a', 'b'])

    // JSON with no ads in it comes back as JSON.parse gives it.
    const plain = { contents: [{ videoRenderer: { videoId: 'a' } }], playerAdsCount: 2 }
    assert.deepEqual(page.parse(JSON.stringify(plain)), plain)
  })

  test('takes the ads out of a YouTube API response read with json()', async () => {
    const page = openPage('https://m.youtube.com/watch?v=1')

    const api = await new page.Response('https://m.youtube.com/youtubei/v1/player', playerResponse()).json()
    assert.deepEqual(Object.keys(api), ['videoDetails', 'streamingData'])

    const other = await new page.Response('https://m.youtube.com/api/other', playerResponse()).json()
    assert.ok(other.adPlacements)
  })

  test('hides sponsored cards but nothing of the player, so an ad that plays keeps its Skip button', () => {
    const page = openPage('https://m.youtube.com/')
    assert.equal(page.styles.length, 1)
    assert.match(page.styles[0], /ytm-promoted-sparkles-web-renderer/)
    assert.match(page.styles[0], /ad-slot-renderer/)
    assert.doesNotMatch(page.styles[0], /ytp-|skip/i)
  })

  test('leaves other sites alone', () => {
    for (const href of [
      'https://example.com/watch?v=1',
      'https://youtube.com.evil.test/watch?v=1',
      'http://www.youtube.com/watch?v=1'
    ]) {
      const page = openPage(href)
      page.window.ytInitialPlayerResponse = playerResponse()
      assert.ok(page.window.ytInitialPlayerResponse.adPlacements, href)
      assert.ok(page.parse(JSON.stringify(playerResponse())).adPlacements, href)
      assert.equal(page.styles.length, 0, href)
    }
  })

  test('adds nothing for YouTube when its switch is off', () => {
    const script = createBrowserContentBlockingScript({ enabled: true })
    assert.doesNotMatch(script, /ytInitialPlayerResponse/)
    assert.doesNotMatch(script, /adPlacements/)
  })
})

function playerResponse () {
  return {
    videoDetails: { videoId: '1' },
    adPlacements: [{ adPlacementRenderer: {} }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    adSlots: [{ adSlotRenderer: {} }],
    streamingData: { formats: [] },
    adBreakHeartbeatParams: 'Q0FBJTNE'
  }
}

// A list with two videos, a sponsored card and a grid cell holding one.
function feed () {
  return {
    contents: [
      { videoRenderer: { videoId: 'a' } },
      { adSlotRenderer: { adSlotMetadata: {} } },
      { richItemRenderer: { content: { adSlotRenderer: {} } } },
      { richItemRenderer: { content: { videoRenderer: { videoId: 'b' } } } }
    ]
  }
}

function videosIn (data) {
  return data.contents.map((item) => (item.videoRenderer || item.richItemRenderer?.content.videoRenderer)?.videoId)
}

function openPage (href) {
  const styles = []
  class Response {
    constructor (url, data) {
      this.url = url
      this.data = data
    }

    json () {
      return Promise.resolve(this.data)
    }
  }
  const window = {
    fetch: () => Promise.resolve('allowed'),
    XMLHttpRequest: class {
      open () {}
      send () {}
    }
  }
  const context = vm.createContext({
    document: {
      addEventListener () {},
      baseURI: href,
      createElement: () => ({ isConnected: false }),
      head: {
        appendChild (style) {
          style.isConnected = true
          styles.push(style.textContent)
        }
      }
    },
    location: { href },
    Response,
    setTimeout,
    URL,
    window
  })
  vm.runInContext(createBrowserContentBlockingScript({ youtubeAdBlockingEnabled: true }), context)
  return {
    // A copy made here, since objects from the page's own realm never equal
    // this one's in assert.deepEqual.
    parse: (text) => structuredClone(vm.runInContext('JSON.parse(text)', Object.assign(context, { text }))),
    Response,
    styles,
    window
  }
}

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
