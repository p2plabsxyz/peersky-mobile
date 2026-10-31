import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { localPathInAppFolder, OPEN_COPIES_FOLDER, openCopyName } from '../../app/downloads/open-copy.mjs'

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
  assert.match(downloads, /await Sharing\.shareAsync\(namedOpenCopy\(local, name\)\)/)
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

// iOS gives the app a new folder on an update, and an upload's copy kept in
// Recent by its whole path then pointed into the old one: opening it did
// nothing, with no word why.
test('a file kept from before an update is found in the app folder it is in now', () => {
  const old = 'file:///var/mobile/Containers/Data/Application/0F1E/Library/Caches/DocumentPicker/3657E1E8.mp4'
  assert.deepEqual(localPathInAppFolder(old), { root: 'cache', rest: 'DocumentPicker/3657E1E8.mp4' })
  assert.deepEqual(localPathInAppFolder('file:///var/mobile/Containers/Data/Application/0F1E/Documents/browser-downloads/My%20File.pdf'), { root: 'document', rest: 'browser-downloads/My File.pdf' })
  assert.equal(localPathInAppFolder('file:///tmp/clip.mp4'), null)
  assert.equal(localPathInAppFolder('file:///a/Library/Caches/../secret'), null)
  const downloads = read('app/downloads/useBrowserDownloads.ts')
  assert.match(downloads, /const local = currentLocalUri\(uri\)\s+if \(!local\) return false/)
  // One that is gone opens by its address instead.
  const app = read('app/index.tsx')
  assert.match(app, /await openBrowserLocalFile\(item\.localUri, item\.name\)\.catch\(\(\) => false\)/)
})
