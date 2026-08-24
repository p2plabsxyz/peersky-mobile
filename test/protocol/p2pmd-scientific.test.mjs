import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  assertRenderedMarkdownSize,
  createP2pmdMarkdownRenderer,
  renderP2pmdMarkdown
} from '../../backend/p2pmd/scientific.mjs'
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
})
