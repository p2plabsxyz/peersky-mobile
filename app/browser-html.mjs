import { SAD_BIRD_DATA_URI } from './browser-error-art.mjs'
import { describeBrowserError } from './browser-error-copy.mjs'

export function createHyperBrowserHtml (response, targetUrl, isDark = false) {
  const body = response.body || ''
  const contentType = response.headers?.['content-type'] || ''

  if (contentType.includes('application/json')) {
    return createHyperDirectoryHtml(body, targetUrl, isDark)
  }

  if (contentType.includes('text/html') || looksLikeHtml(body)) {
    return ensureBaseHref(ensureMobileViewport(body), targetUrl)
  }

  return createBrowserDocumentHtml(targetUrl, `<pre>${escapeHtml(body)}</pre>`, isDark)
}

function createHyperDirectoryHtml (body, targetUrl, isDark) {
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
      `<h1>Index of ${escapeHtml(targetUrl)}</h1><ul>${links || '<li>No files found.</li>'}</ul>`,
      isDark
    )
  } catch {
    return createBrowserDocumentHtml(targetUrl, `<pre>${escapeHtml(body)}</pre>`, isDark)
  }
}

export function createBrowserErrorHtml (targetUrl, message, isDark = false) {
  const { title, body } = describeBrowserError(targetUrl, message)
  const detail = String(message || '').trim()

  // The raw message goes in a details element rather than a box on the page.
  // It is the first thing somebody debugging wants and the last thing anybody
  // else needs to read.
  return createBrowserDocumentHtml(
    title,
    `<div class="error">
  <img class="art" src="${SAD_BIRD_DATA_URI}" alt="" width="180" height="180" />
  <h1>${escapeHtml(title)}</h1>
  <p class="lead">${escapeHtml(body)}</p>
  <p class="address">${escapeHtml(targetUrl)}</p>
  ${detail ? `<details><summary>What went wrong</summary><pre>${escapeHtml(detail)}</pre></details>` : ''}
</div>`,
    isDark
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

// Light and dark written out rather than left to prefers-color-scheme. The
// media query follows the system, and the app has its own theme setting that
// can disagree with it, so a page built here would come out light while every
// piece of chrome around it was dark. These are the palette's own colours.
const DOCUMENT_THEMES = {
  light: {
    page: '#ffffff',
    ink: '#151821',
    muted: '#657086',
    link: '#0f6fd4',
    block: '#f4f6f8',
    blockEdge: '#dce2ea'
  },
  dark: {
    page: '#18181b',
    ink: '#e7eaf0',
    muted: '#98a1b2',
    link: '#6fb0ff',
    block: '#27272a',
    blockEdge: '#3f3f46'
  }
}

function createBrowserDocumentHtml (title, body, isDark = false) {
  const theme = isDark ? DOCUMENT_THEMES.dark : DOCUMENT_THEMES.light

  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  /* Raw text, a directory listing and a failed page all land here. color-scheme
     is what makes the engine paint its own furniture, scrollbars and form
     controls, to match rather than staying light over a dark page. */
  :root { color-scheme: ${isDark ? 'dark' : 'light'}; }
  body {
    background: ${theme.page};
    color: ${theme.ink};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.55;
    margin: 0;
    padding: 22px;
  }
  a { color: ${theme.link}; }
  ul { padding-left: 20px; }
  li { margin: 10px 0; overflow-wrap: anywhere; }
  pre {
    background: ${theme.block};
    border: 1px solid ${theme.blockEdge};
    border-radius: 8px;
    overflow: auto;
    padding: 14px;
    white-space: pre-wrap;
  }
  .muted {
    color: ${theme.muted};
    overflow-wrap: anywhere;
  }

  /* Centred in the viewport rather than pinned to the top: a short message in
     the corner of an empty screen reads as something that went wrong twice. */
  .error {
    align-items: center;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    margin: 0 auto;
    max-width: 30rem;
    min-height: calc(100vh - 44px);
    text-align: center;
  }
  .art {
    height: auto;
    margin-bottom: 18px;
    max-width: 180px;
    width: 45%;
  }
  .error h1 {
    font-size: 1.45rem;
    line-height: 1.3;
    margin: 0 0 10px;
  }
  .lead {
    color: ${theme.muted};
    font-size: 1rem;
    margin: 0 0 18px;
    overflow-wrap: anywhere;
  }
  .address {
    color: ${theme.muted};
    font-size: 0.82rem;
    margin: 0;
    overflow-wrap: anywhere;
    opacity: 0.75;
  }
  details {
    margin-top: 26px;
    text-align: left;
    width: 100%;
  }
  summary {
    color: ${theme.muted};
    cursor: pointer;
    font-size: 0.85rem;
    list-style: none;
    text-align: center;
  }
  summary::-webkit-details-marker { display: none; }
  details pre { font-size: 0.8rem; margin-top: 10px; }
</style>
${body}
`
}

// Relative links on a hyper:// page resolve against its own address. The
// WebView is given that address as the page's base URL too (on iOS through
// PeerSkyWebView's hyper:// handler); the tag says the same in the document,
// which keeps hyper:// URLs intact for the navigation interceptor.
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
