import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'
import {
  createPublishedNoteHtml,
  createPublishedSlidesHtml
} from '../../backend/hyper/drive.mjs'
import {
  hasSlideBreaks,
  inlineHyperPreviewImages,
  renderMarkdownPreview,
  renderMarkdownSlides,
  splitMarkdownSlides
} from '../../backend/p2pmd/preview.mjs'

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

  it('renders inline and display LaTeX without allowing raw HTML', () => {
    const html = renderMarkdownPreview('Inline $E = mc^2$\n\n$$\\sum_{i=1}^{n} i$$\n\n<script>alert(1)</script>')

    assert.match(html, /class="katex"/)
    assert.match(html, /class="katex-display"/)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  })

  it('bounds pathological LaTeX expressions', () => {
    const html = renderMarkdownPreview(`$${'x'.repeat(10001)}$`)

    assert.match(html, /Math expression is too long/)
  })

  it('publishes scientific notes with self-contained KaTeX and optional IEEE layout', () => {
    const source = '<!-- ieee -->\n\n## Paper\n\n### Abstract\n\nEquation $x^2$.'
    const ieeeHtml = createPublishedNoteHtml(source, true)
    const regularHtml = createPublishedNoteHtml(source, false)

    assert.match(ieeeHtml, /class="katex"/)
    assert.match(ieeeHtml, /window\.P2pmdIeee\.render/)
    assert.match(ieeeHtml, /font-src data:/)
    assert.match(ieeeHtml, /script-src 'unsafe-inline'/)
    assert.doesNotMatch(regularHtml, /window\.P2pmdIeee\.render/)
    assert.doesNotMatch(regularHtml, /script-src/)
  })

  it('splits slides using the desktop delimiters and normalizes line endings', () => {
    const slides = splitMarkdownSlides('# One\r\n\r\n---\r\n\r\n# Two\r\n<!-- slide -->\r\n# Three')

    assert.deepEqual(slides, ['# One', '# Two', '# Three'])
  })

  it('does not split slide-like lines inside fenced code blocks', () => {
    const slides = splitMarkdownSlides('# Code\n\n```md\n---\n<!-- slide -->\n```\n\n---\n\n# Next')

    assert.equal(slides.length, 2)
    assert.match(slides[0], /```md\n---\n<!-- slide -->\n```/)
    assert.equal(slides[1], '# Next')
  })

  it('preserves Setext headings and indented code that use dashes', () => {
    const setextSlides = splitMarkdownSlides('Title\n---\n\nBody')
    const indentedSlides = splitMarkdownSlides('# Code\n\n    ---\n\nText')

    assert.deepEqual(setextSlides, ['Title\n---\n\nBody'])
    assert.deepEqual(indentedSlides, ['# Code\n\n    ---\n\nText'])
  })

  // Mobile used to insist on a blank line after "---" as well as before it, so
  // "---\n# Next slide" was not a break here while it was on desktop. Inserting
  // an image leaves exactly that shape, which is how a deck came out as one
  // long note. Only the blank line *before* matters, and only because it tells
  // a slide break apart from a Setext heading.
  it('breaks a slide without needing a blank line after the separator', () => {
    assert.deepEqual(
      splitMarkdownSlides('# First\n\n---\n\n# Second'),
      ['# First', '# Second']
    )
    assert.deepEqual(
      splitMarkdownSlides('# First\n\n---\n# Second'),
      ['# First', '# Second']
    )
    assert.deepEqual(
      splitMarkdownSlides('![shot](hyper://a/i.png)\n\n---\n# Second'),
      ['![shot](hyper://a/i.png)', '# Second']
    )
  })

  it('splits a leading separator the way desktop does', () => {
    assert.deepEqual(splitMarkdownSlides('---\n# Heading\n\nText'), ['# Heading\n\nText'])
  })

  // Desktop splits on any bare "---" with /^---$/gm. That agrees with this for
  // every real deck, and is wrong for a Setext heading or a dash line inside a
  // code fence, which the two tests above cover. Nothing else may drift.
  it('agrees with the desktop slide splitter on every deck shape', () => {
    const desktopSplit = (markdown) => markdown
      .split(/^---$|^<!-- slide -->$/gm)
      .map((slide) => slide.trim())
      .filter((slide) => slide.length > 0)

    const decks = [
      '# One\n\ntext\n\n---\n\n# Two\n\ntext',
      '# One\n\ntext\n\n---\n# Two\ntext',
      '# One\n\n![shot](hyper://a/i.png)\n\n---\n# Two',
      '# One\n\n<!-- slide -->\n# Two',
      '---\n# Heading\n\nText',
      '# Title\n\n![shot](hyper://a/i.png)'
    ]

    for (const deck of decks) {
      assert.deepEqual(splitMarkdownSlides(deck), desktopSplit(deck), deck)
    }
  })

  it('renders safe slide HTML and hides speaker notes', () => {
    const result = renderMarkdownSlides('# Welcome\n\n<!-- Speaker notes: private -->\n\n---\n\n<script>alert(1)</script>')

    assert.equal(result.count, 2)
    assert.match(result.html, /<section class="slide active" data-slide-index="0"><h1>Welcome<\/h1>/)
    assert.match(result.html, /<section class="slide" data-slide-index="1">/)
    assert.doesNotMatch(result.html, /Speaker notes: private/)
    assert.match(result.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.doesNotMatch(result.html, /<script>alert\(1\)<\/script>/)
  })

  it('renders a document without delimiters as one slide', () => {
    const result = renderMarkdownSlides('## A single slide')

    assert.equal(result.count, 1)
    assert.match(result.html, /<h2>A single slide<\/h2>/)
  })

  it('builds a self-contained interactive Hyper slide deck', () => {
    const html = createPublishedSlidesHtml('# First\n\n<!-- private note -->\n\n---\n\n# Second')

    assert.equal((html.match(/<section class="slide/g) || []).length, 2)
    assert.doesNotMatch(html, /private note/)
    assert.match(html, /<meta http-equiv="Content-Security-Policy"/)
    assert.match(html, /document\.addEventListener\('keydown'/)
    assert.match(html, /addEventListener\('touchstart'/)
    assert.match(html, /aria-label="Previous slide"/)
    assert.match(html, /function fitActiveSlide\(\)/)
    assert.match(html, /window\.matchMedia\('\(orientation: landscape\)'\)/)
    assert.match(html, /window\.addEventListener\('resize', scheduleFit\)/)
  })

  it('includes LaTeX rendering in presentation slides', () => {
    const html = createPublishedSlidesHtml('# Formula\n\n$$x^2$$')

    assert.match(html, /class="katex-display"/)
    assert.match(html, /font-family:KaTeX_Main/)
  })
})

/**
 * The editor asks "is this already a deck?" before offering to replace the
 * document with the slides template. That check was a separate regular
 * expression, and when the splitter stopped requiring a blank line after "---"
 * the two stopped agreeing: a real deck failed the check and the editor offered
 * to throw it away. They are one function now, and these keep them honest.
 */
describe('p2pmd deck detection', () => {
  const documents = [
    '# a\n\ntext',
    '# a\n\n---\n\n# b',
    '# a\n\n---\n# b',
    '![i](hyper://a/i.png)\n\n---\n# b',
    '# a\n\n<!-- slide -->\n# b',
    '---\n# b\n\ntext',
    'Title\n---\n\nbody',
    '# c\n\n```\n---\n```\n\ntext',
    '# c\n\n    ---\n\ntext',
    ''
  ]

  it('sees a deck wherever the splitter finds a break', () => {
    for (const markdown of documents) {
      if (splitMarkdownSlides(markdown).length > 1) {
        assert.equal(hasSlideBreaks(markdown), true, markdown)
      }
    }
  })

  it('never calls a plain note a deck', () => {
    for (const markdown of documents) {
      if (!hasSlideBreaks(markdown)) {
        assert.ok(splitMarkdownSlides(markdown).length <= 1, markdown)
      }
    }
  })

  it('leaves a Setext heading and a fenced dash line alone', () => {
    assert.equal(hasSlideBreaks('Title\n---\n\nbody'), false)
    assert.equal(hasSlideBreaks('# c\n\n```\n---\n```\n\ntext'), false)
  })

  it('recognises the deck the editor writes from its own template', () => {
    assert.equal(hasSlideBreaks('# One\n\ntext\n\n---\n\n# Two'), true)
  })
})
