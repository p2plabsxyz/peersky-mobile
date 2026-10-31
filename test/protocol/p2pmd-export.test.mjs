// Export PDF and Export slides from a note's share button. The note is the
// page a publish makes, opened where hyper:// means nothing, so its pictures
// go inside it.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportMarkdownDocument, inlineExportImages } from '../../backend/hyper/drive.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function files (entries) {
  const reads = []
  const readFile = async ({ url }) => {
    reads.push(url)
    return entries[url] || { ok: false, status: 404, error: 'No file' }
  }
  return { reads, readFile }
}

test('a note exports as the page a publish makes, with its pictures inside', async () => {
  const { reads, readFile } = files({
    'hyper://abc/a.png': { ok: true, bytes: PNG, contentType: 'image/png' }
  })
  const result = await exportMarkdownDocument({
    content: '# Trip\n\n![first](hyper://abc/a.png)\n\n![gone](hyper://abc/gone.png)',
    mode: 'note'
  }, { readFile })

  assert.equal(result.ok, true)
  assert.match(result.html, /<h1>Trip<\/h1>/)
  assert.match(result.html, new RegExp(`src="data:image/png;base64,${PNG.toString('base64')}"`))
  // One that cannot be read keeps its address rather than failing the export.
  assert.match(result.html, /src="hyper:\/\/abc\/gone\.png"/)
  assert.deepEqual(reads, ['hyper://abc/a.png', 'hyper://abc/gone.png'])
})

test('a note\'s tables and quotes print with their lines', async () => {
  const result = await exportMarkdownDocument({ content: '| A | B |\n|---|---|\n| 1 | 2 |\n\n> quoted', mode: 'note' }, { readFile: files({}).readFile })
  assert.match(result.html, /<table>/)
  assert.match(result.html, /th,\s+td \{\s+border: 1px solid #c9ccd1;/)
  assert.match(result.html, /thead \{\s+display: table-header-group;/)
  assert.match(result.html, /blockquote \{\s+border-left: 3px solid #c9ccd1;/)
})

// A timesheet exported its Date, Time In and Time Out columns a letter or two
// a line ("Da/te", "8:/00/A/M"): its cells could break anywhere, so the table
// gave nearly all the page to the long Task column.
test('a table keeps the words in its cells whole, so short columns keep their width', async () => {
  const result = await exportMarkdownDocument({ content: '| Date | Task |\n|---|---|\n| Mon, Oct 19 | Long work |', mode: 'note' }, { readFile: files({}).readFile })
  const start = result.html.indexOf('  th,\n  td {')
  const cells = result.html.slice(start, result.html.indexOf('}', start))
  assert.match(cells, /overflow-wrap: break-word;/)
  assert.match(cells, /min-width: 7ch;/)
  assert.doesNotMatch(cells, /anywhere/)
  // Only a link or code, which can be one long word, breaks anywhere.
  assert.match(result.html, /th a,\s+th code,\s+td a,\s+td code \{\s+overflow-wrap: anywhere;/)
  // A screen scrolls a wide table; paper keeps it to the page.
  assert.match(result.html, /@media screen \{\s+table \{\s+display: block;\s+overflow-x: auto;/)
})

test('a research paper prints from the pages the editor laid out, a page to a sheet of A4', async () => {
  const content = '<!-- ieee -->\n\n## A Paper\n\nText'
  const pages = '<div class="ieee-page-stack"><div class="ieee-preview-page ieee-preview-page--first">' +
    '<script>alert(1)</script><img src="/hyper/file?url=hyper%3A%2F%2Fabc%2Ffig.png" alt=""></div></div>'
  const { readFile } = files({ 'hyper://abc/fig.png': { ok: true, bytes: PNG, contentType: 'image/png' } })
  const paper = await exportMarkdownDocument({ content, mode: 'note', latexModeEnabled: true, paperHtml: pages }, { readFile })
  assert.equal(paper.ok, true)
  assert.equal(paper.paper, 'a4')
  assert.match(paper.html, /class="ieee-preview-page ieee-preview-page--first"/)
  assert.match(paper.html, /@page \{ size: A4; margin: 0; \}/)
  assert.match(paper.html, /box-shadow: none;/)
  // No script runs where it prints, and its pictures are read from their drive.
  assert.doesNotMatch(paper.html, /<script/)
  assert.match(paper.html, new RegExp(`src="data:image/png;base64,${PNG.toString('base64')}"`))

  // Without the pages, or for a note that is not a paper, the note prints as before.
  const plain = await exportMarkdownDocument({ content, mode: 'note', latexModeEnabled: true }, { readFile })
  assert.equal(plain.paper, undefined)
  const notPaper = await exportMarkdownDocument({ content: '## Not a paper', mode: 'note', latexModeEnabled: true, paperHtml: pages }, { readFile })
  assert.equal(notPaper.paper, undefined)
  assert.doesNotMatch(notPaper.html, /class="ieee-preview-page/)
})

test('slides export as the presentation a publish makes', async () => {
  const result = await exportMarkdownDocument({ content: '# One\n\n---\n\n# Two', mode: 'slides' }, { readFile: files({}).readFile })
  assert.equal(result.ok, true)
  assert.equal((result.html.match(/<section class="slide/g) || []).length, 2)
  assert.match(result.html, /<title>P2PMD Slides<\/title>/)
})

test('only pictures go inside, each read once, within the size cap', async () => {
  const big = Buffer.alloc(21 * 1024 * 1024, 1)
  const { reads, readFile } = files({
    'hyper://abc/page.html': { ok: true, bytes: Buffer.from('<p>no</p>'), contentType: 'text/html' },
    'hyper://abc/huge.png': { ok: true, bytes: big, contentType: 'image/png' },
    'hyper://abc/a.png?x=1&y=2': { ok: true, bytes: PNG, contentType: 'image/png' }
  })
  const html = [
    '<img src="hyper://abc/page.html">',
    '<img src="hyper://abc/huge.png">',
    '<img src="hyper://abc/a.png?x=1&amp;y=2">',
    '<img src="hyper://abc/a.png?x=1&amp;y=2">'
  ].join('')
  const inlined = await inlineExportImages(html, readFile)

  assert.match(inlined, /<img src="hyper:\/\/abc\/page\.html">/)
  assert.match(inlined, /<img src="hyper:\/\/abc\/huge\.png">/)
  assert.equal((inlined.match(/src="data:image\/png;base64,/g) || []).length, 2)
  assert.deepEqual(reads, ['hyper://abc/page.html', 'hyper://abc/huge.png', 'hyper://abc/a.png?x=1&y=2'])
})

test('a note that is not text is refused', async () => {
  assert.equal((await exportMarkdownDocument({ content: 5 })).ok, false)
  assert.equal((await exportMarkdownDocument({})).ok, false)
})
