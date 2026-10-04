import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { WEBVIEW_DECELERATION_RATE } from '../../app/webview-scroll.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Left unset, react-native-webview hands iOS a deceleration rate of 0, so a
// swipe stopped the moment the finger lifted, in pages and apps alike.
test('every WebView people scroll glides on after a swipe', async () => {
  // The browser's tabs and the note editor.
  const app = await read('app/index.tsx')
  assert.equal((app.match(/decelerationRate=\{WEBVIEW_DECELERATION_RATE\}/g) || []).length, 2)
  assert.match(await read('app/peertunes/PeerTunesScreen.tsx'), /decelerationRate=\{WEBVIEW_DECELERATION_RATE\}/)
  assert.match(await read('app/BrowserMediaSheet.tsx'), /decelerationRate=\{WEBVIEW_DECELERATION_RATE\}/)
})

// Android hands the prop to a native view that reads it as a double, so the
// string 'normal' crashed the app when PeerTunes, a note or the media viewer
// opened. iOS only coped because its JavaScript swaps the string for a number.
test('the glide rate is the number iOS makes of normal, never a string', async () => {
  assert.equal(typeof WEBVIEW_DECELERATION_RATE, 'number')
  const ios = await read('node_modules/react-native-webview/src/WebView.ios.tsx')
  assert.match(ios, new RegExp(`=== 'normal'\\) \\{\\s*newDecelerationRate = ${WEBVIEW_DECELERATION_RATE};`))

  const files = await readdir(new URL('../../app/', import.meta.url), { recursive: true })
  for (const file of files.filter((name) => /\.tsx?$/.test(name))) {
    assert.doesNotMatch(await read(`app/${file}`), /decelerationRate=['"]/, file)
  }
})
