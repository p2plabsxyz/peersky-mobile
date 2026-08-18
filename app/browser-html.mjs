export function createHyperBrowserHtml (response, targetUrl) {
  const body = response.body || ''
  const contentType = response.headers?.['content-type'] || ''

  if (contentType.includes('application/json')) {
    return createHyperDirectoryHtml(body, targetUrl)
  }

  if (contentType.includes('text/html') || looksLikeHtml(body)) {
    return ensureMobileViewport(body)
  }

  return createBrowserDocumentHtml(targetUrl, `<pre>${escapeHtml(body)}</pre>`)
}

function createHyperDirectoryHtml (body, targetUrl) {
  try {
    const files = JSON.parse(body)
    if (!Array.isArray(files)) throw new Error('Expected a directory listing')

    const links = files
      .map((file) => {
        const name = String(file)
        const href = createHyperChildUrl(targetUrl, name)
        return `<li><a href="${escapeHtmlAttribute(href)}">${escapeHtml(name)}</a></li>`
      })
      .join('')

    return createBrowserDocumentHtml(
      targetUrl,
      `<h1>Index of ${escapeHtml(targetUrl)}</h1><ul>${links || '<li>No files found.</li>'}</ul>`
    )
  } catch {
    return createBrowserDocumentHtml(targetUrl, `<pre>${escapeHtml(body)}</pre>`)
  }
}

export function createBrowserErrorHtml (targetUrl, message) {
  return createBrowserDocumentHtml(
    'PeerSky could not load this page',
    `<h1>Page failed</h1><p class="muted">${escapeHtml(targetUrl)}</p><pre>${escapeHtml(message)}</pre>`
  )
}

export function createHyperMediaHtml ({ mediaName, mediaType, mediaUrl }) {
  const name = escapeHtml(String(mediaName || 'Hyper media'))
  const source = escapeHtmlAttribute(String(mediaUrl || ''))
  const media = mediaType === 'image'
    ? `<img src="${source}" alt="${name}" />`
    : mediaType === 'audio'
      ? `<audio src="${source}" controls preload="metadata"></audio>`
      : `<video src="${source}" controls playsinline preload="metadata"></video>`

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${name}</title>
  <style>
    html, body { background: #11151d; height: 100%; margin: 0; }
    body { align-items: center; display: flex; justify-content: center; overflow: auto; }
    img, video { display: block; max-height: 100%; max-width: 100%; object-fit: contain; }
    audio { max-width: calc(100% - 32px); width: 520px; }
  </style>
</head>
<body>${media}</body>
</html>`
}

function createBrowserDocumentHtml (title, body) {
  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body {
    color: #151821;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.55;
    margin: 0;
    padding: 22px;
  }
  a { color: #0f6fd4; }
  ul { padding-left: 20px; }
  li { margin: 10px 0; overflow-wrap: anywhere; }
  pre {
    background: #f4f6f8;
    border: 1px solid #dce2ea;
    border-radius: 8px;
    overflow: auto;
    padding: 14px;
    white-space: pre-wrap;
  }
  .muted {
    color: #657086;
    overflow-wrap: anywhere;
  }
</style>
${body}
`
}

function ensureMobileViewport (html) {
  if (/<meta\s+[^>]*name=["']viewport["'][^>]*>/i.test(html)) return html

  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1" />'

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>${viewport}`)
  }

  return `${viewport}\n${html}`
}

function createHyperChildUrl (baseUrl, childPath) {
  try {
    const parsed = new URL(baseUrl)
    const pathname = childPath.startsWith('/') ? childPath : `${parsed.pathname.replace(/\/?$/, '/')}${childPath}`
    return `hyper://${parsed.host}${pathname}`
  } catch {
    return childPath
  }
}

function looksLikeHtml (body) {
  return /^\s*<(?:!doctype|html|head|body|main|section|article|div|h1|p)\b/i.test(body)
}

function escapeHtml (value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlAttribute (value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}
