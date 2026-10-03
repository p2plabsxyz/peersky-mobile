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

    // The page steps in around the notch, which in landscape left a band of
    // shell down each side of the photograph.
    assert.match(background, /marginLeft: -bleed\.left, marginRight: -bleed\.right/)
    assert.match(index, /paddingLeft: BROWSER_HOME_PADDING \+ browserInsets\.left/)
    assert.match(index, /bleed=\{\{ left: browserInsets\.left, right: browserInsets\.right \}\}/)
  })

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
