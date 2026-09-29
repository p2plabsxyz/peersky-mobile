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
    // One for each theme, so the labels keep the colour they already had.
    assert.match(index, /rgba\(24, 24, 27, 0\.45\)/)
    assert.match(index, /rgba\(255, 255, 255, 0\.72\)/)
  })

  test('the picture runs to the bottom edge', async () => {
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    // A strip of shell paint under the home indicator read as a gap at the
    // bottom of the photograph, so the page fills it the way a web page does
    // and clears the indicator with its own padding instead.
    assert.match(index, /browserSource\.kind === 'home'\)$/m)
    assert.match(index, /paddingBottom: 36 \+ browserInsets\.bottom/)
  })

  test('the wallpaper is small enough to ship', async () => {
    const file = await stat(new URL('../../assets/images/wallpaper-ten-lakes.jpg', import.meta.url))

    // The desktop copy is 2.6MB at 3024px, which is a lot of bundle for a
    // backdrop nobody looks at directly.
    assert.ok(file.size < 900 * 1024, `wallpaper is ${Math.round(file.size / 1024)}KB`)
  })
})
