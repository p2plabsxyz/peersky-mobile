import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

// App Store guideline 5.2.5 turns down apps that look like an Apple product.
// PeerTunes keeps its player shell, but none of Apple's product names, in
// what people see or in the code behind it.
test('PeerTunes does not use Apple product names', async () => {
  const root = new URL('../../assets/peertunes/', import.meta.url)
  const files = (await readdir(root, { recursive: true })).filter((name) => /\.(html|css|js|json|webmanifest)$/.test(name))
  assert.ok(files.length > 5)
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8')
    assert.doesNotMatch(text, /\bipod\b|click ?wheel|cover ?flow/i, file)
  }
  const runtime = await readFile(new URL('../../backend/peertunes/peertunes-runtime.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(runtime, /\bipod\b|click ?wheel|cover ?flow/i)
})

// Nor its exact details: the wheel's top shows a menu glyph, not MENU, and
// the center button is a rounded square inside the round wheel.
test('the PeerTunes wheel is not the iPod wheel', async () => {
  const read = (path) => readFile(new URL(`../../assets/peertunes/${path}`, import.meta.url), 'utf8')
  const [html, main, css, welcome, icons] = await Promise.all([
    read('index.html'), read('js/main.js'), read('css/style.css'), read('js/welcome.js'), read('assets/icons.js')
  ])
  assert.match(html, /<span class="wz wz-menu" data-btn="menu"><\/span>/)
  assert.match(main, /document\.querySelector\("\.wz-menu"\)\.innerHTML = PT\.icons\.menu;/)
  assert.match(icons, /menu: `<svg viewBox="0 0 14 12">/)
  for (const text of [html, welcome]) assert.doesNotMatch(text, /MENU/)
  const center = css.slice(css.indexOf('.wheel-center {'), css.indexOf('}', css.indexOf('.wheel-center {')))
  assert.match(center, /border-radius: 34%;/)
  const welcomeCenter = css.slice(css.indexOf('.wl-center {'), css.indexOf('}', css.indexOf('.wl-center {')))
  assert.match(welcomeCenter, /border-radius: 34%;/)
  assert.match(welcome, /data-icon="menu"/)
})
