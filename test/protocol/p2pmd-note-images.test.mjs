import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'
import { forgetNoteImages, readNoteImage } from '../../backend/hyper/drive.mjs'
import { readNoteImages } from '../../backend/p2pmd/note-images.mjs'
import { inlineHyperPreviewImages, renderMarkdownPreview } from '../../backend/p2pmd/preview.mjs'

const PNG = b4a.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const KEY = 'a'.repeat(64)

// A drive as the runtime hands it over, holding files.
function runtimeWith (files, opened = []) {
  return {
    getDrive: async (address) => {
      opened.push(address)
      return {
        core: {},
        entry: async (path) => files[path] ? { value: { blob: { byteLength: files[path].byteLength } } } : null,
        get: async (path) => files[path] || null
      }
    }
  }
}

const notPrivate = async () => false

describe('pictures of a note on other devices\' drives', () => {
  afterEach(() => forgetNoteImages())

  // A picture dropped in on a desktop is on that desktop's P2PMD drive, and a
  // phone that joined the note showed none of them.
  it('reads a picture from a public drive named by its key', async () => {
    const opened = []
    const result = await readNoteImage({ url: `hyper://${KEY}/media/fig.png` }, { runtime: runtimeWith({ '/media/fig.png': PNG }, opened), isPrivate: notPrivate })
    assert.equal(result.ok, true)
    assert.equal(result.contentType, 'image/png')
    assert.deepEqual(opened, [`hyper://${KEY}/`])
  })

  it('reads pictures only', async () => {
    const svg = b4a.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const result = await readNoteImage({ url: `hyper://${KEY}/x.svg` }, { runtime: runtimeWith({ '/x.svg': svg }), isPrivate: notPrivate })
    assert.equal(result.ok, false)
    assert.equal(result.status, 415)

    const big = await readNoteImage({ url: `hyper://${KEY}/big.png` }, {
      runtime: runtimeWith({ '/big.png': { byteLength: 10 * 1024 * 1024 + 1 } }),
      isPrivate: notPrivate
    })
    assert.equal(big.status, 413)
  })

  it('never reads hyper://localhost, a named drive, a private drive or a folder', async () => {
    const opened = []
    const runtime = runtimeWith({ '/a.png': PNG }, opened)
    for (const url of ['hyper://localhost/a.png', 'hyper://p2pmd/a.png', 'hyper://example.com/a.png', 'https://example.com/a.png', `hyper://${KEY}/`]) {
      const result = await readNoteImage({ url }, { runtime, isPrivate: notPrivate })
      assert.equal(result.ok, false, url)
    }
    const privateDrive = await readNoteImage({ url: `hyper://${KEY}/a.png` }, { runtime, isPrivate: async () => true })
    assert.equal(privateDrive.status, 403)
    assert.deepEqual(opened, [])
  })

  it('does not ask again for a picture it just read or could not read', async () => {
    const opened = []
    const options = { runtime: runtimeWith({ '/a.png': PNG }, opened), isPrivate: notPrivate }
    await readNoteImage({ url: `hyper://${KEY}/a.png` }, options)
    await readNoteImage({ url: `hyper://${KEY}/a.png` }, options)
    await readNoteImage({ url: `hyper://${KEY}/gone.png` }, options)
    await readNoteImage({ url: `hyper://${KEY}/gone.png` }, options)
    assert.equal(opened.length, 2)
  })

  it('reads a few at a time, from a few drives, and waits no longer than it may', async () => {
    let reading = 0
    let most = 0
    const asked = []
    const urls = Array.from({ length: 12 }, (_, index) => `hyper://${String(index % 10).repeat(64)}/p${index}.png`)
    const results = await readNoteImages(urls, async ({ url }) => {
      asked.push(url)
      reading += 1
      most = Math.max(most, reading)
      await new Promise((resolve) => setTimeout(resolve, 5))
      reading -= 1
      return { ok: true, bytes: PNG, contentType: 'image/png' }
    })
    assert.equal(most, 4)
    // Ten drives named, eight read from: the two pictures on drives 8 and 9 are left.
    assert.equal(asked.length, 10)
    assert.equal(results.size, 10)

    const started = Date.now()
    const stuck = await readNoteImages([`hyper://${KEY}/a.png`], () => new Promise(() => {}), { waitMs: 50 })
    assert.equal(stuck.size, 0)
    assert.ok(Date.now() - started < 1000)
  })

  // When the phone joins a note hosted on a desktop, the address the preview
  // falls back to goes to the desktop, which has nothing there.
  it('puts every picture of a note inside its preview', async () => {
    const content = Array.from({ length: 9 }, (_, index) => `![Figure ${index}](hyper://${KEY}/media/fig${index}.png)`).join('\n\n')
    const files = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`/media/fig${index}.png`, PNG]))
    const html = await inlineHyperPreviewImages(renderMarkdownPreview(content), (request) => readNoteImage(request, { runtime: runtimeWith(files), isPrivate: notPrivate }))
    assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 9)
    assert.doesNotMatch(html, /\/hyper\/file\?url=/)
  })
})
