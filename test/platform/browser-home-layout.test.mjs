import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AVERAGE_BOLD_GLYPH_RATIO,
  getBrowserShortcutLabelWidth,
  getBrowserShortcutTitleFontSize
} from '../../app/browser-home-layout.mjs'

const drawnWidth = (characters, fontSize) => characters * AVERAGE_BOLD_GLYPH_RATIO * fontSize

// "Hyperdrive" and "PeerTunes" both wrapped onto a second line on a 13 mini,
// which left the shortcut row ragged with some labels one line and some two.
const LONGEST_TITLE = 'Hyperdrive'.length
const MINI_WIDTH = 375

test('a 13 mini gives each label about 77pt', () => {
  assert.ok(Math.abs(getBrowserShortcutLabelWidth(MINI_WIDTH) - 76.75) < 0.01)
})

test('the longest shortcut name fits on one line on a 13 mini', () => {
  const size = getBrowserShortcutTitleFontSize(MINI_WIDTH, LONGEST_TITLE)
  const drawn = drawnWidth(LONGEST_TITLE, size)
  assert.ok(drawn <= getBrowserShortcutLabelWidth(MINI_WIDTH), `${drawn}pt did not fit`)
})

// app.json sets an iOS deployment target of 16.0, so the narrowest iPhone that
// can run this is 375pt: the SE 2 and 3, the 8, and the 12 and 13 mini.
test('the longest shortcut name fits on every phone width we support', () => {
  for (const width of [375, 390, 393, 402, 414, 430, 440]) {
    const size = getBrowserShortcutTitleFontSize(width, LONGEST_TITLE)
    const drawn = drawnWidth(LONGEST_TITLE, size)
    assert.ok(drawn <= getBrowserShortcutLabelWidth(width), `${width}pt wide: ${drawn}pt did not fit`)
  }
})

test('a wide screen gets more type, up to the size the design started at', () => {
  assert.equal(getBrowserShortcutTitleFontSize(375, LONGEST_TITLE), 11)
  assert.equal(getBrowserShortcutTitleFontSize(430, LONGEST_TITLE), 13)
  assert.equal(getBrowserShortcutTitleFontSize(1024, LONGEST_TITLE), 14)
})

test('a screen narrower than any supported phone stops shrinking rather than vanishing', () => {
  // Below 375pt the label cannot fit on one line at a readable size, so it
  // holds at the floor and wraps. numberOfLines={2} catches it.
  assert.equal(getBrowserShortcutTitleFontSize(320, LONGEST_TITLE), 11)
  assert.equal(getBrowserShortcutTitleFontSize(0, LONGEST_TITLE), 11)
})

test('a longer name added later gets a smaller size, not a second line', () => {
  // On a mini the type is already at the floor, so compare where there is room
  // to move: a longer name has to cost size rather than wrap.
  const width = 430
  const longer = getBrowserShortcutTitleFontSize(width, 'Hyperdrive Pro'.length)
  assert.ok(longer < getBrowserShortcutTitleFontSize(width, LONGEST_TITLE))
})
