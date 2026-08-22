import b4a from 'b4a'
import {
  assertRenderedMarkdownSize,
  createP2pmdMarkdownRenderer,
  renderP2pmdMarkdown
} from './scientific.mjs'

const P2PMD_PREVIEW_IMAGE_SRC_PATTERN = /src="\/hyper\/file\?url=([^"]+)"/g
const MAX_INLINE_PREVIEW_IMAGES = 5
const MAX_INLINE_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_INLINE_PREVIEW_IMAGE_TOTAL_BYTES = 10 * 1024 * 1024
const SLIDE_DELIMITER = '<!-- slide -->'
const markdownRenderer = createP2pmdMarkdownRenderer()
const defaultImageRenderer = markdownRenderer.renderer.rules.image || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options)
}

markdownRenderer.renderer.rules.image = function (tokens, idx, options, env, self) {
  const srcIndex = tokens[idx].attrIndex('src')
  if (srcIndex >= 0) {
    const src = tokens[idx].attrs[srcIndex][1]
    if (typeof src === 'string' && src.startsWith('hyper://')) {
      tokens[idx].attrs[srcIndex][1] = `/hyper/file?url=${encodeURIComponent(src)}`
    }
  }

  return defaultImageRenderer(tokens, idx, options, env, self)
}

export function renderMarkdownPreview (content) {
  return renderP2pmdMarkdown(markdownRenderer, content)
}

export function splitMarkdownSlides (content) {
  const slides = []
  let currentSlide = []
  let fence = null
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)

    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) {
        fence = { character: marker[0], length: marker.length }
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length &&
        new RegExp(`^\\s{0,3}${fence.character}{${fence.length},}\\s*$`).test(line)
      ) {
        fence = null
      }
    }

    const trimmedLine = line.trim()
    const previousLine = currentSlide[currentSlide.length - 1]
    const nextLine = lines[index + 1]
    const hasBlankBefore = currentSlide.length === 0 || !String(previousLine).trim()
    const hasBlankAfter = nextLine === undefined || !nextLine.trim()
    const isHorizontalSlideBreak = line === '---' && hasBlankBefore && hasBlankAfter
    const isCommentSlideBreak = trimmedLine.toLowerCase() === SLIDE_DELIMITER

    if (!fence && (isHorizontalSlideBreak || isCommentSlideBreak)) {
      appendSlide(slides, currentSlide)
      currentSlide = []
      continue
    }

    currentSlide.push(line)
  }

  appendSlide(slides, currentSlide)
  return slides
}

export function renderMarkdownSlides (content) {
  const slides = splitMarkdownSlides(content)
  const renderedSlides = (slides.length > 0 ? slides : [''])
    .map((slide, index) => {
      const rendered = renderP2pmdMarkdown(markdownRenderer, stripSpeakerNotes(slide))
      return `<section class="slide${index === 0 ? ' active' : ''}" data-slide-index="${index}">${rendered}</section>`
    })

  const html = renderedSlides.join('')
  assertRenderedMarkdownSize(html)

  return {
    count: renderedSlides.length,
    html
  }
}

function appendSlide (slides, lines) {
  const slide = lines.join('\n').trim()
  if (slide) slides.push(slide)
}

function stripSpeakerNotes (content) {
  return content.replace(/<!--[\s\S]*?-->/g, '')
}

export async function inlineHyperPreviewImages (html, readFile) {
  const imageSources = Array.from(html.matchAll(P2PMD_PREVIEW_IMAGE_SRC_PATTERN))
  if (imageSources.length === 0) return html

  const replacements = new Map()

  for (const match of imageSources) {
    const encodedUrl = match[1]
    if (replacements.has(encodedUrl)) continue
    if (replacements.size >= MAX_INLINE_PREVIEW_IMAGES) break

    let url
    try {
      url = decodeURIComponent(encodedUrl)
    } catch {
      continue
    }

    let result
    try {
      result = await readFile({ url })
    } catch {
      continue
    }

    if (!result.ok) continue
    if (!result.bytes || typeof result.bytes.byteLength !== 'number') continue
    if (typeof result.contentType !== 'string' || !result.contentType.startsWith('image/')) continue
    if (result.bytes.byteLength < 1 || result.bytes.byteLength > MAX_INLINE_PREVIEW_IMAGE_BYTES) continue

    replacements.set(
      encodedUrl,
      {
        byteLength: result.bytes.byteLength,
        source: `src="data:${result.contentType};base64,${b4a.toString(result.bytes, 'base64')}"`
      }
    )
  }

  let imageCount = 0
  let totalBytes = 0

  return html.replace(P2PMD_PREVIEW_IMAGE_SRC_PATTERN, (source, encodedUrl) => {
    const replacement = replacements.get(encodedUrl)
    if (!replacement) return source
    if (imageCount >= MAX_INLINE_PREVIEW_IMAGES) return source
    if (totalBytes + replacement.byteLength > MAX_INLINE_PREVIEW_IMAGE_TOTAL_BYTES) return source

    imageCount += 1
    totalBytes += replacement.byteLength
    return replacement.source
  })
}
