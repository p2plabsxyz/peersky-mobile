import MarkdownIt from 'markdown-it'

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
