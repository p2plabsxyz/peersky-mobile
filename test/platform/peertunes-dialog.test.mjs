import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// A dialog's text has to fit a share link, which is one long word. break-all
// did that, and on a phone it also split plain words in two: "ri ght now".
test('PeerTunes dialog text wraps a long link without splitting words', async () => {
  const css = await readFile(new URL('../../assets/peertunes/css/style.css', import.meta.url), 'utf8')
  const start = css.indexOf('.dlg .dsub {')
  const sub = css.slice(start, css.indexOf('}', start))
  assert.match(sub, /overflow-wrap: anywhere;/)
  assert.doesNotMatch(sub, /word-break: break-all/)
})
