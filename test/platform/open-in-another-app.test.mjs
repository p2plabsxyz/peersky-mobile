import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { OPEN_COPIES_FOLDER, openCopyName } from '../../app/downloads/open-copy.mjs'

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')

// On iOS, Open it after an upload did nothing: the share sheet was asked for
// while the upload's sheet was still closing, and iOS shows none then. And a
// file handed to another app went by the name of the picker's or the chat's
// copy, a number such as 3657E1E8-....mp4.
test('an upload opened from its sheet waits for the sheet to close on iOS', () => {
  const screen = read('app/hyperdrive/HyperdriveScreen.tsx')
  assert.match(screen, /if \(item\) openOnceClosed\(item, true\)/)
  assert.match(screen, /onDismiss=\{\(\) => \{\s+const item = openAfterSheet\.current\s+openAfterSheet\.current = null\s+if \(item\) onOpenItem\(item\)/)
  assert.match(screen, /\{ text: t\('Open'\), onPress: \(\) => openOnceClosed\(openItem\) \}/)
  // Android has no such wait.
  assert.match(screen, /if \(Platform\.OS !== 'ios'\) \{\s+onOpenItem\(item\)\s+return\s+\}/)
  const sheet = read('app/PublishedLinkSheet.tsx')
  assert.match(sheet, /onRequestClose=\{onClose\}\s+onDismiss=\{onDismiss\}/)
})

test('a file goes to another app by its own name', () => {
  const downloads = read('app/downloads/useBrowserDownloads.ts')
  assert.match(downloads, /await Sharing\.shareAsync\(namedOpenCopy\(uri, name\)\)/)
  assert.equal(openCopyName('clip (1).mp4'), 'clip (1).mp4')
  assert.equal(openCopyName('a/b\\c.txt'), 'a_b_c.txt')
  assert.equal(openCopyName('x\u0001y.pdf'), 'x_y.pdf')
  assert.equal(openCopyName(''), '')
  assert.equal(openCopyName('..'), '')
  assert.equal(openCopyName('a'.repeat(300)).length, 200)
})

test('the named copy goes with Remove my data and Clear all P2P data', () => {
  const save = read('app/peerchat/media-save.ts')
  assert.match(save, /\['peerchat-save', 'ImageManipulator', 'ImagePicker', 'DocumentPicker', OPEN_COPIES_FOLDER\]/)
  assert.equal(OPEN_COPIES_FOLDER, 'peersky-open')
})
