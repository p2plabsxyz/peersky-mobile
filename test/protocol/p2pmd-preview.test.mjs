import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdownPreview } from '../../backend/p2pmd/preview.mjs'

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

  it('keeps ordinary Markdown rendering enabled', () => {
    const html = renderMarkdownPreview('# Title\n\nhttps://peersky.p2plabs.xyz/')

    assert.match(html, /<h1>Title<\/h1>/)
    assert.match(html, /href="https:\/\/peersky.p2plabs.xyz\//)
  })
})
