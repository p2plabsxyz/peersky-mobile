import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createForceDarkScript,
  createForceDarkRemovalScript,
  FORCE_DARK_STYLE_ID
} from '../../app/browser-force-dark.mjs'

describe('force dark mode', () => {
  test('turning it off removes what turning it on added', () => {
    // The same id both ways, or switching it off leaves the page inverted
    // until it is reloaded.
    assert.match(createForceDarkScript(false), new RegExp(FORCE_DARK_STYLE_ID))
    assert.equal(createForceDarkScript(false), createForceDarkRemovalScript())
    assert.match(createForceDarkRemovalScript(), /style\.remove\(\)/)
  })

  test('media is inverted back, so photos are not negatives', () => {
    const script = createForceDarkScript(true)

    assert.match(script, /html\{filter:invert\(1\) hue-rotate\(180deg\)/)
    assert.match(script, /img,picture,video,canvas,svg,iframe,embed,object,/)
  })

  test('a site that is already dark is left alone', () => {
    const script = createForceDarkScript(true)

    assert.match(script, /isAlreadyDark/)
    assert.match(script, /red \* 0\.299 \+ green \* 0\.587 \+ blue \* 0\.114\) < 128/)
    // Transparent says nothing about the colour, so it must not count as light.
    assert.match(script, /Number\(parts\[3\]\) === 0\) continue/)
  })

  test('the rule lands even when it runs before the document exists', () => {
    const script = createForceDarkScript(true)

    assert.match(script, /document\.head \|\| document\.documentElement/)
    assert.match(script, /readyState === 'loading'/)
  })
})
