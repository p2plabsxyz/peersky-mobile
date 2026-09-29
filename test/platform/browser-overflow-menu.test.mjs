import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const menu = await readFile(new URL('../../app/settings/BrowserOverflowMenu.tsx', import.meta.url), 'utf8')

describe('browser menu', () => {
  test('opens from the bottom, where the hand already is', () => {
    assert.match(menu, /justifyContent: 'flex-end'/)
    assert.match(menu, /borderTopLeftRadius: 22/)
    assert.match(menu, /grabber/)
  })

  test('the sheet slides while the dimming fades, not together', () => {
    // Modal's own slide carries the backdrop up with the sheet, which looks
    // like a shutter closing over the page rather than a sheet rising in
    // front of it.
    assert.match(menu, /animationType='none'/)
    assert.match(menu, /styles\.backdrop, \{ opacity: open \}/)
    assert.match(menu, /transform: \[\{\s*\n\s*translateY: open\.interpolate/)
  })

  test('two big actions, then grouped rows', () => {
    assert.match(menu, /<BigAction[\s\S]{0,400}label='New Tab'/)
    assert.match(menu, /<BigAction[\s\S]{0,400}label='Settings'/)
    assert.match(menu, /function withDividers/)
    // Dividers start past the icon, so the rows read as one card.
    assert.match(menu, /divider: \{[\s\S]{0,120}marginLeft: 56/)
  })

  test('nothing is left anchoring it to a corner', () => {
    // The popup had to be told where the toolbar was, and got it wrong every
    // time the toolbar moved. A sheet does not need telling.
    assert.doesNotMatch(menu, /attachedAbove|attachedBelow/)
    assert.doesNotMatch(menu, /offset\?: number/)
  })

  test('the home indicator is cleared once, by the scroll content', () => {
    assert.doesNotMatch(menu, /edges=\{\['top', 'left', 'right', 'bottom'\]\}/)
    assert.match(menu, /paddingBottom: Math\.max\(insets\.bottom, 12\)/)
  })
})
