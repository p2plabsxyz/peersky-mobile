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
