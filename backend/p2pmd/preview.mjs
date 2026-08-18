import b4a from 'b4a'
import MarkdownIt from 'markdown-it'

const P2PMD_PREVIEW_IMAGE_SRC_PATTERN = /src="\/hyper\/file\?url=([^"]+)"/g
const MAX_INLINE_PREVIEW_IMAGES = 5
const MAX_INLINE_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_INLINE_PREVIEW_IMAGE_TOTAL_BYTES = 10 * 1024 * 1024
const markdownRenderer = new MarkdownIt({
  // Security-critical: preview output is injected with innerHTML in the WebView.
  // Keep raw HTML disabled unless the preview path is sanitized first.
  html: false,
  linkify: true,
  breaks: true
})
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
  return markdownRenderer.render(content)
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
