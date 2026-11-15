// In a PeerChat room, the back arrow in the bottom bar went to the page
// behind PeerChat, while the edge swipe and the Android button left the room.
// The arrow was wired to page history alone.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
const navBar = app.slice(app.indexOf('const browserNavBar = ('), app.indexOf('onBurnTabs={onBrowserBurnTabs}'))

test('the back arrow takes the same step back as the button and the swipe', () => {
  assert.match(navBar, /canGoBack=\{browserBackAvailable\}/)
  assert.match(navBar, /onBack=\{goBrowserBack\}/)
  // Which leaves an open chat before going back a page.
  const back = app.slice(app.indexOf('function goBrowserBack () {'), app.indexOf('useEffect(() => {', app.indexOf('function goBrowserBack () {')))
  assert.ok(back.indexOf('peerChatGoBackRef.current?.()') < back.indexOf('onBrowserBack()'))
  assert.match(app, /const browserBackAvailable = browserOverPage \|\| canBrowserGoBack/)
})

// Safari's Back in a tab that a link opened closes it and shows the page that
// opened it. PeerSky did that only for the Android button: on iOS the arrow
// was greyed out and the edge swipe did nothing.
test('Back in a tab a link opened goes back to the tab that opened it', () => {
  assert.match(app, /const browserOpenerTabId = browserTabOpenersRef\.current\.get\(browserTabsState\.activeTabId\)/)
  assert.match(app, /const browserCanCloseToOpener = Boolean\(browserOpenerTabId\) &&\s+browserTabsState\.tabs\.some\(\(tab\) => tab\.id === browserOpenerTabId\)/)
  assert.match(app, /const browserBackAvailable = browserOverPage \|\| canBrowserGoBack \|\| driveViewerCanGoBack \|\| browserCanCloseToOpener/)
  // The arrow and the swipe both go by it, and what they do is the same back.
  assert.match(app, /browserCanGoBackRef\.current = browserBackAvailable/)
  assert.match(app, /else if \(closeTabToOpener\(\)\) return true/)
})
