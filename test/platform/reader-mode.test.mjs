import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  canUseReaderView,
  createReaderHtml,
  createReaderScript,
  MAX_READER_HTML_LENGTH,
  parseReaderMessage,
  READER_MESSAGE_TYPE,
  sanitizeReaderHtml
} from '../../app/reader/reader-mode.mjs'

// Reader view shows a page's article on its own, from the menu.

const TOKEN = 'a1b2c3'
const message = (fields) => JSON.stringify({ type: READER_MESSAGE_TYPE, token: TOKEN, ok: true, title: 'Lakes', byline: '', siteName: 'Trail Notes', lang: 'en', dir: 'ltr', html: '<p>The loop is 6 km.</p>', ...fields })

test('reader view is for websites and hyper:// sites, not the app\'s own screens', () => {
  assert.equal(canUseReaderView('https://example.com/post'), true)
  assert.equal(canUseReaderView('hyper://blog.example/post.html'), true)
  assert.equal(canUseReaderView('peersky://home'), false)
  assert.equal(canUseReaderView('peersky://p2p'), false)
  assert.equal(canUseReaderView(''), false)
})

test('the page script is valid and answers with the tab\'s token', () => {
  const script = createReaderScript(TOKEN)
  assert.doesNotThrow(() => new Function(script)) // eslint-disable-line no-new-func
  assert.match(script, new RegExp(`token: "${TOKEN}"`))
  assert.match(script, /window\.__peerskyPostNative/)
})

test('only an answer with the tab\'s token is taken, and a page with no article says so', () => {
  assert.equal(parseReaderMessage(message({}), 'other'), null)
  assert.equal(parseReaderMessage(message({}), ''), null)
  assert.equal(parseReaderMessage('{"type":"peersky-print-page"}', TOKEN), null)
  assert.equal(parseReaderMessage('not json', TOKEN), null)

  const article = parseReaderMessage(message({ title: ' Lakes\u202e of\n the north ' }), TOKEN)
  assert.equal(article.ok, true)
  assert.equal(article.title, 'Lakes of the north')
  assert.equal(article.html, '<p>The loop is 6 km.</p>')

  assert.equal(parseReaderMessage(message({ ok: false }), TOKEN).ok, false)
  assert.equal(parseReaderMessage(message({ html: 'x'.repeat(MAX_READER_HTML_LENGTH + 1) }), TOKEN).ok, false)
  assert.equal(parseReaderMessage(message({ lang: 'en"><script>' }), TOKEN).lang, '')
})

test('the article keeps text elements, links and pictures, and nothing that runs or restyles', () => {
  const dirty = [
    '<p onclick="steal()">Hi <script>alert(1)</script></p>',
    '<a href="javascript:alert(1)">bad</a><a href="https://ok.example/" style="color:red">ok</a>',
    '<img src="https://i.example/a.png" alt="A lake" onerror="steal()">',
    '<img src="data:image/svg+xml,x">',
    '<iframe src="https://x.example"></iframe><meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<style>body{display:none}</style><base href="https://evil.example/"><form action="https://evil.example"><input></form>'
  ].join('')
  const clean = sanitizeReaderHtml(dirty)
  assert.doesNotMatch(clean, /<(script|iframe|meta|style|base|form|input)/i)
  assert.doesNotMatch(clean, /on\w+=|javascript:|style=/i)
  assert.match(clean, /<a href="https:\/\/ok\.example\/">ok<\/a>/)
  assert.match(clean, /<img src="https:\/\/i\.example\/a\.png" alt="A lake">/)
  assert.doesNotMatch(clean, /data:image/)
})

test('the reader page allows no scripts and no forms, and follows the chosen size and theme', () => {
  const article = parseReaderMessage(message({}), TOKEN)
  const light = createReaderHtml(article, { textScale: 100 })
  assert.match(light, /Content-Security-Policy" content="default-src 'none'; img-src https: http: hyper: data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"/)
  assert.match(light, /font: 18\.0px/)
  assert.match(light, /<h1 class="title">Lakes<\/h1>/)
  assert.match(light, /<p class="site">Trail Notes<\/p>/)
  const dark = createReaderHtml({ ...article, title: '<b>x</b>' }, { isDark: true, textScale: 150 })
  assert.match(dark, /color-scheme: dark/)
  assert.match(dark, /font: 27\.0px/)
  assert.match(dark, /&lt;b&gt;x&lt;\/b&gt;/)
})

test('the reader view runs no scripts and opens links in the tab', async () => {
  const view = await readFile(new URL('../../app/reader/ReaderView.tsx', import.meta.url), 'utf8')
  assert.match(view, /javaScriptEnabled=\{false\}/)
  assert.match(view, /onOpenLink\(request\.url\)/)
  const menu = await readFile(new URL('../../app/settings/BrowserOverflowMenu.tsx', import.meta.url), 'utf8')
  assert.match(menu, /label='Reader View'/)
})
