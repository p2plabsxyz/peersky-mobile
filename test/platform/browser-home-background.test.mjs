import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { describe, test } from 'node:test'

describe('home wallpaper', () => {
  test('the picture sits behind a scrim, not behind bare text', async () => {
    const background = await readFile(
      new URL('../../app/BrowserHomeBackground.tsx', import.meta.url),
      'utf8'
    )
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    assert.match(background, /resizeMode='cover'/)
    assert.match(background, /backgroundColor: scrim/)
    // Not the same number in both: a white veil flattens a photograph in a
    // way a dark one does not, so matching the numbers does not match the
    // look. The labels carry their own contrast instead.
    assert.match(index, /rgba\(24, 24, 27, 0\.35\)/)
    assert.match(index, /rgba\(255, 255, 255, 0\.14\)/)
    const styles = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')
    assert.match(styles, /browserShortcutTitleOnLight[\s\S]{0,140}textShadowRadius: 5/)
    assert.match(styles, /browserShortcutTitleOnDark[\s\S]{0,140}textShadowRadius: 5/)
  })

  test('the picture runs down to the navigation bar', async () => {
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    // The navigation bar is the last thing on screen now, so it owns the
    // bottom edge and the wallpaper simply runs into it. Nothing else paints a
    // strip down there, which is what used to read as a gap.
    assert.doesNotMatch(index, /browserWebViewFillsBottomInset/)
    assert.match(index, /const browserBottomInsetColor = browserIsPortrait \? browserToolbarColor/)
  })

  test('the wallpaper is small enough to ship', async () => {
    const file = await stat(new URL('../../assets/images/wallpaper-ten-lakes.jpg', import.meta.url))

    // The desktop copy is 2.6MB at 3024px, which is a lot of bundle for a
    // backdrop nobody looks at directly.
    assert.ok(file.size < 900 * 1024, `wallpaper is ${Math.round(file.size / 1024)}KB`)
  })
})
