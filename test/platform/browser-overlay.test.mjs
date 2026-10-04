import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

// Settings, bookmarks, history, downloads and an open note used to replace the
// browser outright, which unmounted every tab and PeerTunes with it: opening
// Settings stopped the music.
test('full-screen pages open over the browser instead of replacing it', () => {
  const pages = app.slice(app.indexOf('let browserOverlay: ReactNode = null'), app.indexOf('const browserToolbar = ('))
  assert.ok(pages.length > 0)
  for (const page of ['browserBookmarksVisible', 'browserHistoryVisible', 'browserDownloadsVisible', 'browserSettingsVisible', "activeTab === 'p2pmd'"]) {
    assert.ok(pages.includes(page), page)
  }
  assert.doesNotMatch(pages, /^ {4}return \(/m)

  // The same tree either way, so opening a page never remounts the browser.
  const end = app.slice(app.indexOf('const browser = ('))
  assert.match(end, /<View style=\{styles\.browserShellContent\}>\s+\{browser\}\s+\{browserOverlay && <View style=\{StyleSheet\.absoluteFill\}>\{browserOverlay\}<\/View>\}/)
  assert.match(end, /importantForAccessibility=\{browserOverlay \? 'no-hide-descendants' : 'auto'\}/)
})
