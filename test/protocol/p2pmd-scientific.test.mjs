import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  assertRenderedMarkdownSize,
  createP2pmdMarkdownRenderer,
  P2PMD_SCIENTIFIC_STYLES,
  renderP2pmdMarkdown
} from '../../backend/p2pmd/scientific.mjs'
import ieeeBrowserScript from '../../backend/p2pmd/ieee-runtime.mjs'
import {
  getP2pmdTemplate,
  hasIeeeMarker,
  P2PMD_TEMPLATES
} from '../../backend/p2pmd/templates.mjs'

describe('p2pmd scientific templates', () => {
  it('ships the desktop-compatible research and technical templates', () => {
    assert.deepEqual(
      P2PMD_TEMPLATES.map((template) => template.id),
      ['research-paper-md', 'technical-doc-md']
    )
    assert.equal(getP2pmdTemplate('research-paper-md')?.ieeeMode, true)
    assert.equal(getP2pmdTemplate('technical-doc-md')?.ieeeMode, false)
    assert.match(getP2pmdTemplate('research-paper-md').content, /\$\$[\s\S]+\$\$/)
    assert.match(getP2pmdTemplate('technical-doc-md').content, /\| Endpoint \| Method \| Purpose \|/)
  })

  // A template that shows an image from the web tells that site who opened
  // it, and the image's licence travels with every note made from it.
  it('loads nothing from the web', () => {
    for (const template of P2PMD_TEMPLATES) {
      assert.doesNotMatch(template.content, /!\[[^\]]*\]\(\s*https?:/i, template.id)
      assert.doesNotMatch(template.content, /<img[^>]+src=["']?https?:/i, template.id)
    }
  })

  it('requires the IEEE marker at the start of a document', () => {
    assert.equal(hasIeeeMarker('  <!-- ieee -->\n\n# Paper'), true)
    assert.equal(hasIeeeMarker('# Paper\n\n<!-- ieee -->'), false)
    assert.equal(hasIeeeMarker('<!-- another marker -->'), false)
  })

  it('bounds aggregate LaTeX rendering and rendered output', () => {
    const renderer = createP2pmdMarkdownRenderer()
    const formulas = Array.from({ length: 2001 }, () => '$x$').join(' ')

    assert.throws(
      () => renderP2pmdMarkdown(renderer, formulas),
      /too much LaTeX/
    )
    assert.throws(
      () => assertRenderedMarkdownSize('x'.repeat((10 * 1024 * 1024) + 1)),
      /Rendered Markdown is too large/
    )
  })

  it('paginates rich paragraphs with DOM ranges instead of plain text', async () => {
    const source = await readFile(
      new URL('../../backend/p2pmd/ieee-browser-entry.js', import.meta.url),
      'utf8'
    )

    assert.match(source, /const MAX_PAGES = 250/)
    assert.match(source, /document\.createRange\(\)/)
    assert.match(source, /range\.cloneContents\(\)/)
    assert.doesNotMatch(source, /fit\.textContent\s*=/)
    assert.doesNotMatch(source, /remaining\.textContent\s*=/)
  })

  // An iPhone prints CSS columns as one: all the text in the first, the rest
  // cut off at the foot of the page. The pages a PDF is made from have their
  // two columns as boxes of their own, filled one after the other.
  it('lays a paper out for print with each page\'s columns as boxes of their own', async () => {
    const source = await readFile(
      new URL('../../backend/p2pmd/ieee-browser-entry.js', import.meta.url),
      'utf8'
    )

    assert.match(source, /async function render \(preview, html, options = \{\}\)/)
    assert.match(source, /paginate\(token, buildLayout\(html\), stack, options\.splitColumns === true\)/)
    assert.match(source, /columns\.classList\.add\('ieee-preview-columns--split'\)/)
    assert.match(source, /box\.className = 'ieee-preview-column'/)
    // The page's second column, then the next page.
    assert.match(source, /if \(box \+ 1 < current\.boxes\.length\) \{\s+box \+= 1\s+continue\s+\}/)
    assert.match(P2PMD_SCIENTIFIC_STYLES, /\.ieee-preview-columns\.ieee-preview-columns--split \{ display: flex; gap: 1\.35rem; column-count: auto; \}/)
    assert.match(P2PMD_SCIENTIFIC_STYLES, /\.ieee-preview-column > :is\(h2, h3, h4, h5, h6\) \{ margin: \.7rem 0 \.2rem; text-align: center; \}/)
    assert.match(ieeeBrowserScript, /ieee-preview-columns--split/)
  })

  // The editor keeps the pages it has up while new ones are laid out, and shows
  // the note as text only when it is too long for pages, not when a newer
  // layout took over.
  it('tells a layout that was taken over from a paper too long for pages', async () => {
    const source = await readFile(
      new URL('../../backend/p2pmd/ieee-browser-entry.js', import.meta.url),
      'utf8'
    )
    const render = source.slice(source.indexOf('async function render ('), source.indexOf('function clear ('))

    assert.match(render, /if \(token !== runToken\) \{\s+staging\.remove\(\)\s+return null\s+\}\s+if \(!complete\) \{\s+staging\.remove\(\)\s+return false\s+\}/)
    assert.ok(render.indexOf('preview.replaceChildren(stack)') < render.indexOf('fitPages(preview)'))
    assert.ok(render.indexOf('fitPages(preview)') < render.indexOf('requestAnimationFrame('))
    assert.match(ieeeBrowserScript, /return null/)
  })

  // A table wider than its column was cut off at the column's edge, on the
  // screen and in the PDF.
  it('makes a table wider than its column smaller until it fits', async () => {
    const source = await readFile(
      new URL('../../backend/p2pmd/ieee-browser-entry.js', import.meta.url),
      'utf8'
    )

    assert.match(source, /const MIN_TABLE_ZOOM = 0\.5/)
    assert.match(source, /target\.appendChild\(node\)\s+fitTables\(node, target\)/)
    assert.match(source, /table\.style\.zoom = Math\.max\(MIN_TABLE_ZOOM, width \/ natural\)/)
    // Past that, its cells wrap as well.
    assert.match(source, /table\.classList\.add\('ieee-table-wrap'\)/)
    assert.match(P2PMD_SCIENTIFIC_STYLES, /\.ieee-columns table\.ieee-table-wrap \{ table-layout: fixed; width: calc\(100% - 2px\); \}/)
    assert.match(ieeeBrowserScript, /ieee-table-wrap/)
  })

  // Older WebKit leaves "<" unescaped in attributes when it serializes, so
  // cutting a paragraph's HTML on "<br>" could turn a link title into markup.
  it('lays out authors and abstracts with DOM nodes, not HTML strings', async () => {
    const source = await readFile(
      new URL('../../backend/p2pmd/ieee-browser-entry.js', import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(source, /innerHTML\.split/)
    assert.doesNotMatch(source, /innerHTML\s*=\s*\w+\.innerHTML/)
    assert.doesNotMatch(source, /innerHTML\s*=\s*part\b/)
    assert.match(source, /function splitLines \(paragraph\)/)
    assert.match(source, /paragraph\.append\(\.\.\.part\)/)
  })
})
