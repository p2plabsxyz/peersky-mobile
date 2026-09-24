// The editor had one toolbar pinned to the top of the screen holding every
// formatting button. On a phone that is the hardest place to reach while
// typing. The split: what you pick before writing stays at the top, what acts
// on the words follows the keyboard.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const server = await readFile(new URL('../../backend/p2pmd/server.mjs', import.meta.url), 'utf8')
const documentBar = server.slice(
  server.indexOf('<div id="formatting-toolbar"'),
  server.indexOf('<div id="keyboard-toolbar"')
)
const keyboardBar = server.slice(
  server.indexOf('<div id="keyboard-toolbar"'),
  server.indexOf('<input id="image-upload-input"')
)

test('the document bar holds only what you choose before writing', () => {
  const buttons = [...documentBar.matchAll(/data-(?:format|menu)="([a-z0-9-]+)"/g)].map((m) => m[1])
  assert.deepEqual(buttons, ['image', 'slides', 'template'])
})

test('the two document kinds sit behind one button', () => {
  // Two templates as two toolbar icons meant three near-identical page glyphs
  // in a row. One button that opens them keeps the bar readable.
  assert.match(documentBar, /data-menu="template"[^>]*aria-haspopup="true"/)
  assert.match(server, /<div id="template-menu" role="menu"/)
  assert.match(server, /button\.dataset\.template = template\.id/)
  // Built from the template list, so the labels stay whatever templates.mjs
  // says rather than being retyped here.
  assert.match(server, /label\.textContent = template\.label/)
})

test('a template nobody is allowed to apply looks unavailable', () => {
  // applyTemplate refuses for a client until the host turns LaTeX mode on.
  // Left tappable, the entries just did nothing.
  assert.match(server, /const allowed = roomRole === 'host' \|\| latexModeEnabled/)
  assert.match(server, /item\.disabled = !allowed/)
  assert.match(server, /#template-menu button:disabled \{ opacity/)
})

test('slides and templates do not share a glyph', () => {
  const icons = [...documentBar.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(icons).size, icons.length, 'two buttons draw the same path')
})

test('every formatting button moved to the keyboard bar, none were dropped', () => {
  const moved = [...keyboardBar.matchAll(/data-format="([a-z0-9-]+)"/g)].map((m) => m[1])
  assert.deepEqual(moved, [
    'bold', 'italic', 'h1', 'h2', 'ul', 'ol',
    'link', 'inline-code', 'code-block', 'quote',
    'latex', 'inline-math', 'block-math'
  ])
  // LaTeX's own pair still appears only when LaTeX mode is on, and that is
  // driven by the id, which had to travel with them.
  assert.match(keyboardBar, /id="latex-toolbar-group" hidden/)
})

test('the bar is placed by the keyboard, not guessed at', () => {
  // window.innerHeight does not move when the keyboard opens on iOS, so the
  // overlap has to come from visualViewport or the bar sits under the keys.
  assert.match(server, /window\.innerHeight - \(viewport\.height \+ viewport\.offsetTop\)/)
  assert.match(server, /visualViewport\.addEventListener\('resize', syncKeyboardToolbar\)/)
  assert.match(server, /visualViewport\.addEventListener\('scroll', syncKeyboardToolbar\)/)
  // The keyboard animates open, so one read on the next frame lands it.
  assert.match(server, /window\.requestAnimationFrame\(syncKeyboardToolbar\)/)
})

test('the bar shows only while the editor is actually being typed in', () => {
  // Focus, not keyboard height. A simulator with a hardware keyboard never
  // covers the page, and gating on that made the bar vanish after one tap.
  assert.match(server, /const open = document\.activeElement === input && viewMode === 'edit'\n/)
  assert.doesNotMatch(server, /const open = [^\n]*keyboardOverlap\(\) > 0/)
  assert.match(server, /input\.addEventListener\('focus', scheduleKeyboardToolbarSync\)/)
  assert.match(server, /input\.addEventListener\('blur', scheduleKeyboardToolbarSync\)/)
  // Switching to preview or slides closes the keyboard, so the bar goes too.
  const start = server.indexOf('function setViewMode(')
  const setViewMode = server.slice(start, server.indexOf('\n      }', start))
  assert.match(setViewMode, /syncKeyboardToolbar\(\)/)
})

test('pressing a button in the bar does not close the keyboard under it', () => {
  // Blurring the textarea would shut the keyboard and drop the bar with it.
  // The action runs on pointerup, so refusing the focus change costs nothing.
  assert.match(server, /if \(event\.currentTarget === keyboardToolbar\) event\.preventDefault\(\)/)
})

test('a template button applies its template instead of formatting text', () => {
  assert.match(server, /button\[data-format\], button\[data-template\]/)
  assert.match(server, /if \(button\.dataset\.template\) \{\s*applyTemplate\(button\.dataset\.template\)/)
  // Both the tap path and the click path go through the same routing, or one
  // of them silently does nothing.
  assert.match(server, /runToolbarButton\(state\.button\)/)
  assert.match(server, /return runToolbarButton\(getToolbarButton\(event\)\)/)
})
