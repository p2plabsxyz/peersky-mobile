import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

  test('keeps YouTube protection independent from EasyList protection', () => {
    const appSource = readFileSync(
      new URL('../../app/index.tsx', import.meta.url),
      'utf8'
    )
    const privacySource = readFileSync(
      new URL('../../app/settings/Privacy.tsx', import.meta.url),
      'utf8'
    )

    assert.match(
      appSource,
      /youtubeAdBlockingEnabled: browserPreferences[.]youtubeAdBlockingEnabled/
    )
    assert.doesNotMatch(appSource, /createYoutubeAdBlockingScript/)
    assert.match(privacySource, /value=\{youtubeAdBlockingEnabled\}/)
    assert.doesNotMatch(privacySource, /disabled=\{!contentBlockingEnabled/)
  })

  test('uses only the pinned YouTube network path', () => {
    assert.equal(YOUTUBE_AD_BREAK_PATH, '/youtubei/v1/player/ad_break')
  })
})
