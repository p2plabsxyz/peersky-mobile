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
  // Inserting a picture is something you do mid-sentence, so it belongs with
  // the other things that act on the words, within reach of a thumb.
  const buttons = [...documentBar.matchAll(/data-(?:format|menu)="([a-z0-9-]+)"/g)].map((m) => m[1])
  assert.deepEqual(buttons, ['slides', 'template'])
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
    'bold', 'italic', 'h1', 'h2', 'image', 'ul', 'ol',
    'link', 'inline-code', 'code-block', 'quote',
    'latex', 'inline-math', 'block-math'
  ])
  // LaTeX's own pair still appears only when LaTeX mode is on, and that is
  // driven by the id, which had to travel with them.
  assert.match(keyboardBar, /id="latex-toolbar-group" hidden/)
})

test('the bar is placed by the keyboard, not guessed at', () => {
  // visualViewport is the only thing that reports where the keyboard starts:
  // window.innerHeight does not move when it opens on iOS.
  assert.match(server, /viewport\.offsetTop \+ viewport\.height/)
  assert.match(server, /visualViewport\.addEventListener\('resize', syncKeyboardToolbar\)/)
  assert.match(server, /visualViewport\.addEventListener\('scroll', syncKeyboardToolbar\)/)
})

test('the bar hangs off the top of the viewport, not the bottom of the page', () => {
  // Anchored to the bottom and lifted, it slid behind the keyboard whenever
  // iOS scrolled the layout viewport out from under it. Anchored to the top
  // and pushed down to the bottom edge of the visual viewport, the only number
  // it depends on is the one visualViewport reports.
  const css = server.slice(server.indexOf('#keyboard-toolbar {'), server.indexOf('#keyboard-toolbar::-webkit-scrollbar'))
  assert.match(css, /position: fixed;/)
  assert.match(css, /top: 0;/)
  assert.doesNotMatch(css, /bottom:/)
})

test('the bar keeps up with a keyboard that iOS moves without telling us', () => {
  // Scrolling with the keyboard up fires no event we can rely on, so while the
  // editor holds focus the viewport is read every frame instead. It stops as
  // soon as focus goes, and skips the write unless the number changed.
  assert.match(server, /keyboardToolbarFrame = window\.requestAnimationFrame\(trackKeyboardToolbar\)/)
  assert.match(server, /if \(offset === keyboardToolbarOffsetApplied\) return/)
  const start = server.indexOf('function trackKeyboardToolbar()')
  const tracker = server.slice(start, server.indexOf('\n      }', start))
  assert.match(tracker, /document\.activeElement === input && viewMode === 'edit'/)
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

test('the page checks for a deck with the renderer own function', () => {
  // A copy of the rule is how the editor came to offer to delete a real deck.
  // The page embeds hasSlideBreaks itself, so there is nothing to keep in sync.
  assert.match(server, /import \{ hasSlideBreaks, renderMarkdownPreview, renderMarkdownSlides \}/)
  assert.match(server, /hasSlideBreaks\.toString\(\)/)
  assert.match(server, /if \(!hasSlideBreaks\(input\.value\)\)/)
  assert.doesNotMatch(server, /P2PMD_SLIDE_BREAK_PATTERN/)
})

test('view as slides stays reachable from the preview', () => {
  // Hiding the bar outside edit mode left no way to open a deck without going
  // back to editing first. Desktop shows it in every mode.
  assert.match(server, /formattingToolbar\.hidden = viewMode === 'slides'/)
  assert.match(server, /templateTrigger\.disabled = viewMode !== 'edit'/)
})
