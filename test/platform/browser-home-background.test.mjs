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

  test('the wallpaper is sharp enough to look at and small enough to ship', async () => {
    const url = new URL('../../assets/images/wallpaper-ten-lakes.jpg', import.meta.url)
    const file = await stat(url)
    const { height, width } = readJpegSize(await readFile(url))

    // Scaling the whole landscape down to fit left a picture 1248 tall, which
    // the phone then stretched to well over 2000: that is the softness. A
    // portrait crop at the source's own height is sharp and no bigger.
    assert.ok(height >= 2000, `wallpaper is only ${height} tall`)
    assert.ok(width < height, 'the home screen is portrait, so the picture should be')
    // The desktop copy is 2.6MB, which is a lot of bundle for a backdrop.
    assert.ok(file.size < 900 * 1024, `wallpaper is ${Math.round(file.size / 1024)}KB`)
  })
})
