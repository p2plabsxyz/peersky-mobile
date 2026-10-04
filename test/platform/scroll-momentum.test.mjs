import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Left unset, react-native-webview hands iOS a deceleration rate of 0, so a
// swipe stopped the moment the finger lifted, in pages and apps alike.
test('every WebView people scroll glides on after a swipe', async () => {
  // The browser's tabs and the note editor.
  const app = await read('app/index.tsx')
  assert.equal((app.match(/decelerationRate='normal'/g) || []).length, 2)
  assert.match(await read('app/peertunes/PeerTunesScreen.tsx'), /decelerationRate='normal'/)
  assert.match(await read('app/BrowserMediaSheet.tsx'), /decelerationRate='normal'/)
})
