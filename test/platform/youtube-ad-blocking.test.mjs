import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

import {
  YOUTUBE_AD_BLOCKING_SOURCE_COMMIT,
  YOUTUBE_ISOLATED_SCRIPTLETS,
  YOUTUBE_MAIN_SCRIPTLETS
} from '../../app/privacy/generated/youtube-ad-blocking-scriptlets.mjs'
import {
  createYoutubeAdBlockingScript,
  isYoutubeUrl,
  YOUTUBE_AD_BREAK_PATH
} from '../../app/privacy/youtube-ad-blocking.mjs'

const SOURCE_COMMIT = '817e88ffa3e8d80b75ddf8e478c38ce8a57004be'

describe('YouTube ad blocking', () => {
  test('matches only HTTPS YouTube and YouTube nocookie hosts', () => {
    for (const url of [
      'https://youtube.com/watch?v=1',
      'https://www.youtube.com/watch?v=1',
      'https://m.youtube.com/shorts/1',
      'https://www.youtube-nocookie.com/embed/1'
    ]) assert.equal(isYoutubeUrl(url), true, url)

    for (const url of [
      'http://youtube.com/watch?v=1',
      'https://youtube.com.evil.test/watch?v=1',
      'https://notyoutube.com/watch?v=1',
      'https://user:pass@youtube.com/watch?v=1',
      'not a url'
    ]) assert.equal(isYoutubeUrl(url), false, url)
  })

  test('injects pinned scriptlets only for enabled YouTube pages', () => {
    assert.equal(createYoutubeAdBlockingScript({
      enabled: false,
      url: 'https://youtube.com/watch?v=1'
    }), 'true')
    assert.equal(createYoutubeAdBlockingScript({
      enabled: true,
      url: 'https://example.com/'
    }), 'true')

    const script = createYoutubeAdBlockingScript({
      enabled: true,
      url: 'https://music.youtube.com/'
    })
    assert.match(script, /ruleset: ublock-filters/)
    assert.ok(script.length > 100_000)
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
      /createYoutubeAdBlockingScript\(\{\s*enabled: browserPreferences[.]youtubeAdBlockingEnabled,/
    )
    assert.doesNotMatch(
      appSource,
      /enabled: browserPreferences[.]contentBlockingEnabled &&\s*browserPreferences[.]youtubeAdBlockingEnabled/
    )
    assert.match(privacySource, /value=\{youtubeAdBlockingEnabled\}/)
    assert.doesNotMatch(privacySource, /disabled=\{!contentBlockingEnabled/)
  })

  test('preserves source provenance and generated payload integrity', () => {
    const source = JSON.parse(readFileSync(
      new URL('../../assets/youtube-ad-blocking/SOURCE.json', import.meta.url),
      'utf8'
    ))
    assert.equal(YOUTUBE_AD_BLOCKING_SOURCE_COMMIT, SOURCE_COMMIT)
    assert.equal(source.sourceCommit, SOURCE_COMMIT)
    assert.equal(source.license, 'GPL-3.0-or-later')
    assert.equal(source.files[0].sha256, sha256(YOUTUBE_MAIN_SCRIPTLETS))
    assert.equal(source.files[1].sha256, sha256(YOUTUBE_ISOLATED_SCRIPTLETS))
    assert.equal(source.files[2].path, 'src/rules/youtube.json')
    assert.equal(YOUTUBE_AD_BREAK_PATH, '/youtubei/v1/player/ad_break')
    assert.match(readFileSync(
      new URL('../../assets/youtube-ad-blocking/LICENSE', import.meta.url),
      'utf8'
    ), /GNU GENERAL PUBLIC LICENSE\s+Version 3/)
  })
})

function sha256 (value) {
  return createHash('sha256').update(value).digest('hex')
}
