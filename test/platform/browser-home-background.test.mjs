import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { describe, test } from 'node:test'

// The frame size lives in a start-of-frame marker, which is any of SOF0
// through SOF15 except the two that are not frames at all.
function readJpegSize (buffer) {
  let offset = 2
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = buffer[offset + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('No JPEG frame header found')
}

// The average step of the first quantization table, the one for brightness.
// Larger steps throw more away: a camera saves at about 5, a squeezed copy
// at 20 and up.
function readJpegLumaStep (buffer) {
  let offset = 2
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++
      continue
    }
    if (buffer[offset + 1] === 0xdb) {
      const wide = buffer[offset + 4] >> 4
      let total = 0
      for (let index = 0; index < 64; index++) {
        total += wide ? buffer.readUInt16BE(offset + 5 + index * 2) : buffer[offset + 5 + index]
      }
      return total / 64
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  throw new Error('No JPEG quantization table found')
}

describe('home wallpaper', () => {
  test('the picture reaches the glass, the shortcuts keep the notch', async () => {
    const background = await readFile(
      new URL('../../app/BrowserHomeBackground.tsx', import.meta.url),
      'utf8'
    )
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    const styles = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')

    // The page steps in around the notch, which in landscape left a band of
    // shell down each side of the photograph. The home screen is a layer
    // pinned to all four sides instead, which sits over that padding.
    assert.match(styles, /browserHomeLayer: \{\s+bottom: 0,\s+left: 0,\s+position: 'absolute',\s+right: 0,\s+top: 0\s+\}/)
    assert.match(index, /paddingLeft: BROWSER_HOME_PADDING \+ browserInsets\.left/)
    assert.doesNotMatch(background, /bleed/)
  })

  test('the keyboard cuts the picture off instead of scaling it', async () => {
    const background = await readFile(
      new URL('../../app/BrowserHomeBackground.tsx', import.meta.url),
      'utf8'
    )

    // Sized to the space it was given, the photo zoomed every time the
    // keyboard came up and that space got shorter. It keeps the tallest
    // height seen at this width now, and a new width starts over.
    assert.match(background, /current && current\.width === layout\.width && current\.height >= layout\.height\s+\? current\s+: \{ height: layout\.height, width: layout\.width \}/)
    assert.match(background, /style=\{\[styles\.wallpaper, frame \? \{ height: frame\.height \} : styles\.wallpaperFill\]\}/)
    assert.match(background, /<View style=\{styles\.background\} onLayout=\{onLayout\}>/)
    // Pinned to the top, so the bottom is what gets cut off.
    assert.match(background, /wallpaper: \{ left: 0, position: 'absolute', top: 0, width: '100%' \}/)
    assert.match(background, /background: \{ flex: 1, overflow: 'hidden' \}/)
  })

  test('coming back home shows the home screen as it was, without a flash', async () => {
    const background = await readFile(
      new URL('../../app/BrowserHomeBackground.tsx', import.meta.url),
      'utf8'
    )
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const styles = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')

    // Built again on every return, the photo and the icons were decoded
    // again, and they faded in on top of that.
    assert.doesNotMatch(background, /Animated/)
    assert.match(background, /fadeDuration=\{0\}/)
    assert.match(index, /if \(browserSource\.kind === 'home' && !browserHomeMounted\) setBrowserHomeMounted\(true\)/)
    assert.match(index, /\{browserHomeMounted && \(/)
    assert.match(index, /: browserSource\.kind === 'home'\s+\? null/)
    // Out of sight and out of reach while a page is open.
    assert.match(index, /pointerEvents=\{browserSource\.kind === 'home' \? 'auto' : 'none'\}/)
    assert.match(index, /importantForAccessibility=\{browserSource\.kind === 'home' \? 'auto' : 'no-hide-descendants'\}/)
    assert.match(index, /styles\.browserHomeLayer, browserSource\.kind === 'home' \? null : styles\.browserHomeLayerHidden/)
    assert.match(styles, /browserHomeLayerHidden: \{\s+opacity: 0\s+\}/)
  })

  // A tint over the whole photo washed it out. Only the part behind the
  // shortcuts is shaded now, fading out below them, and the labels carry their
  // own contrast. The icons stay as they are whatever the wallpaper.
  test('the picture is shaded only behind the shortcuts, not all over', async () => {
    const background = await readFile(
      new URL('../../app/BrowserHomeBackground.tsx', import.meta.url),
      'utf8'
    )
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    assert.match(background, /resizeMode='cover'/)
    assert.doesNotMatch(background, /scrim/)
    assert.match(background, /const VEIL_HEIGHT = 460/)
    assert.match(background, /<Stop offset='1' stopColor=\{shade\} stopOpacity=\{0\} \/>/)
    assert.match(background, /pointerEvents='none'/)
    // Not the same number in both: a white shade flattens a photograph in a
    // way a dark one does not.
    assert.match(background, /const strength = isDark \? 0\.55 : 0\.4/)
    assert.match(index, /<BrowserHomeBackground isDark=\{browserIsDark\}>/)
    assert.doesNotMatch(index, /rgba\(24, 24, 27, 0\.35\)/)

    const styles = await readFile(new URL('../../app/styles.ts', import.meta.url), 'utf8')
    assert.match(styles, /browserShortcutTitleOnLight[\s\S]{0,140}textShadowRadius: 5/)
    assert.match(styles, /browserShortcutTitleOnDark[\s\S]{0,140}textShadowRadius: 5/)
    // Favourites sit on the same photograph, so their labels get the shadow too.
    const favourites = await readFile(new URL('../../app/favourites/BrowserFavourites.tsx', import.meta.url), 'utf8')
    assert.match(favourites, /style=\{\[styles\.browserShortcutTitle, titleStyle, \{ color: palette\.text \}\]\}/)
    assert.match(index, /titleStyle=\{browserIsDark \? styles\.browserShortcutTitleOnDark : styles\.browserShortcutTitleOnLight\}/)
  })

  test('the picture runs down to the navigation bar', async () => {
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    // The navigation bar is the last thing on screen now, so it owns the
    // bottom edge and the wallpaper simply runs into it. Nothing else paints a
    // strip down there, which is what used to read as a gap.
    assert.doesNotMatch(index, /browserWebViewFillsBottomInset/)
    // In either orientation: the strip used to take the shell colour on its
    // side, which showed as a band under the navigation bar.
    assert.match(index, /const browserBottomInsetColor = browserToolbarColor$/m)
  })

  test('the wallpaper is the desktop photo at full quality', async () => {
    const url = new URL('../../assets/images/wallpaper-ten-lakes.jpg', import.meta.url)
    const file = await stat(url)
    const buffer = await readFile(url)
    const { height, width } = readJpegSize(buffer)

    // A phone turns, and cover then scales the picture to the long edge either
    // way. Cropping it to portrait made landscape stretch it twice over. Both
    // dimensions have to clear the long edge of a phone screen instead.
    assert.ok(width >= 2800, `wallpaper is only ${width} wide`)
    assert.ok(height >= 2300, `wallpaper is only ${height} tall`)
    // The same file the desktop ships. A copy squeezed to half its size went
    // soft in the sky and the water.
    const step = readJpegLumaStep(buffer)
    assert.ok(step < 8, `wallpaper was saved again at a quantization step of ${step}`)
    assert.ok(file.size < 3 * 1024 * 1024, `wallpaper is ${Math.round(file.size / 1024)}KB`)
  })
})
