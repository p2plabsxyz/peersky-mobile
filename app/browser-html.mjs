export function createHyperBrowserHtml (response, targetUrl) {
  const body = response.body || ''
  const contentType = response.headers?.['content-type'] || ''

  if (contentType.includes('application/json')) {
    return createHyperDirectoryHtml(body, targetUrl)
  }

  if (contentType.includes('text/html') || looksLikeHtml(body)) {
    return ensureBaseHref(ensureMobileViewport(body), targetUrl)
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
  /* Raw text, a directory listing and a failed page all land here. Every other
     browser turns these dark with the phone, and a white sheet at night is the
     one part of the app that used to flash. color-scheme is what makes the
     engine paint the page behind the body dark too. */
  :root {
    color-scheme: light dark;
    --page: #ffffff;
    --ink: #151821;
    --ink-muted: #657086;
    --link: #0f6fd4;
    --block: #f4f6f8;
    --block-edge: #dce2ea;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --page: #12151b;
      --ink: #e7eaf0;
      --ink-muted: #98a1b2;
      --link: #6fb0ff;
      --block: #1a1f27;
      --block-edge: #2a313c;
    }
  }

  body {
    background: var(--page);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.55;
    margin: 0;
    padding: 22px;
  }
  a { color: var(--link); }
  ul { padding-left: 20px; }
  li { margin: 10px 0; overflow-wrap: anywhere; }
  pre {
    background: var(--block);
    border: 1px solid var(--block-edge);
    border-radius: 8px;
    overflow: auto;
    padding: 14px;
    white-space: pre-wrap;
  }
  .muted {
    color: var(--ink-muted);
    overflow-wrap: anywhere;
  }
</style>
${body}
`
}

// WKWebView will not render HTML loaded with a baseUrl whose scheme it does not
// know, so hyper:// pages came up blank on iOS while Android was happy. Carry
// the base in the document instead, which both engines honour for resolving
// relative links and which keeps hyper:// URLs intact for the navigation
// interceptor.
function ensureBaseHref (html, targetUrl) {
  if (!targetUrl || /<base\s[^>]*href=/i.test(html)) return html

  const base = `<base href="${escapeHtmlAttribute(targetUrl)}" />`

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>${base}`)
  }

  return `${base}\n${html}`
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
