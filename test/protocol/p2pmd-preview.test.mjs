import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'
import { inlineHyperPreviewImages, renderMarkdownPreview } from '../../backend/p2pmd/preview.mjs'

describe('p2pmd Markdown preview rendering', () => {
  it('escapes raw HTML because preview output is injected with innerHTML', () => {
    const html = renderMarkdownPreview('<img src=x onerror=alert(1)>')

    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/)
  })

  it('rewrites hyper image URLs through the local image proxy', () => {
    const html = renderMarkdownPreview('![pic](hyper://example.com/assets/pic.png)')

    assert.match(html, /<img/)
    assert.match(html, /alt="pic"/)
    assert.match(html, /src="\/hyper\/file\?url=hyper%3A%2F%2Fexample.com%2Fassets%2Fpic.png"/)
  })

  it('can inline proxied Hyper images for native bridge previews', async () => {
    const html = renderMarkdownPreview('![pic](hyper://example.com/assets/pic.png)')
    const inlined = await inlineHyperPreviewImages(html, async ({ url }) => {
      assert.equal(url, 'hyper://example.com/assets/pic.png')

      return {
        ok: true,
        bytes: b4a.from('image-bytes'),
        contentType: 'image/png'
      }
    })

    assert.match(inlined, /<img/)
    assert.match(inlined, /alt="pic"/)
    assert.match(inlined, /src="data:image\/png;base64,aW1hZ2UtYnl0ZXM="/)
    assert.doesNotMatch(inlined, /\/hyper\/file\?url=/)
  })

  it('keeps the proxy URL if a Hyper preview image cannot be read locally', async () => {
    const html = renderMarkdownPreview('![pic](hyper://example.com/assets/pic.png)')
    const inlined = await inlineHyperPreviewImages(html, async () => {
      return {
        ok: false,
        error: 'Only P2PMD drive images can be proxied.'
      }
    })

    assert.match(inlined, /src="\/hyper\/file\?url=hyper%3A%2F%2Fexample.com%2Fassets%2Fpic.png"/)
  })

  it('bounds native bridge preview image inlining', async () => {
    const content = Array.from({ length: 7 }, (_, index) => {
      return `![pic${index}](hyper://example.com/assets/pic${index}.png)`
    }).join('\n')
    const html = renderMarkdownPreview(content)
    const inlined = await inlineHyperPreviewImages(html, async () => {
      return {
        ok: true,
        bytes: b4a.from('image-bytes'),
        contentType: 'image/png'
      }
    })

    const dataUrlCount = (inlined.match(/src="data:image\/png;base64,/g) || []).length
    const proxyUrlCount = (inlined.match(/src="\/hyper\/file\?url=/g) || []).length

    assert.equal(dataUrlCount, 5)
    assert.equal(proxyUrlCount, 2)
  })

  it('bounds repeated native bridge preview image references too', async () => {
    const content = Array.from({ length: 7 }, () => {
      return '![pic](hyper://example.com/assets/pic.png)'
    }).join('\n')
    const html = renderMarkdownPreview(content)
    const inlined = await inlineHyperPreviewImages(html, async () => {
      return {
        ok: true,
        bytes: b4a.from('image-bytes'),
        contentType: 'image/png'
      }
    })

    const dataUrlCount = (inlined.match(/src="data:image\/png;base64,/g) || []).length
    const proxyUrlCount = (inlined.match(/src="\/hyper\/file\?url=/g) || []).length

    assert.equal(dataUrlCount, 5)
    assert.equal(proxyUrlCount, 2)
  })

  it('keeps oversized native bridge preview images on the proxy path', async () => {
    const html = renderMarkdownPreview('![pic](hyper://example.com/assets/pic.png)')
    const inlined = await inlineHyperPreviewImages(html, async () => {
      return {
        ok: true,
        bytes: b4a.alloc((5 * 1024 * 1024) + 1),
        contentType: 'image/png'
      }
    })

    assert.match(inlined, /src="\/hyper\/file\?url=hyper%3A%2F%2Fexample.com%2Fassets%2Fpic.png"/)
  })

  it('keeps ordinary Markdown rendering enabled', () => {
    const html = renderMarkdownPreview('# Title\n\nhttps://peersky.p2plabs.xyz/')

    assert.match(html, /<h1>Title<\/h1>/)
    assert.match(html, /href="https:\/\/peersky.p2plabs.xyz\//)
  })
})
