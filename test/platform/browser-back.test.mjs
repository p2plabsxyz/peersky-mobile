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
