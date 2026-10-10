import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// A sheet runs to the bottom edge of the screen, under the home indicator or
// Android's navigation bar, rather than stopping short of it over a grey band
// of backdrop.

const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

test('sheets reach the bottom edge and only their rows step clear of it', async () => {
  for (const [file, padding] of [
    ['app/BrowserMediaSheet.tsx', 26],
    ['app/BrowserZoomSheet.tsx', 28],
    ['app/PublishedLinkSheet.tsx', 24],
    ['app/P2pmdNewNoteSheet.tsx', 24]
  ]) {
    const source = await read(file)
    assert.match(source, /<SafeAreaView style=\{styles\.overlay\} edges=\{\['top', 'left', 'right'\]\}>/, file)
    assert.match(source, new RegExp(`paddingBottom: ${padding} \\+ insets\\.bottom`), file)
  }
})
