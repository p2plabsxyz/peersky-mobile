// A hyper:// page on the phone is HTML handed to a WebView that has never
// heard of the scheme: there is no WKURLSchemeHandler for hyper://, so
// fetch('hyper://...') from page script throws before it reaches anything.
// Static assets survive because the backend inlines them as data: URIs before
// the page loads, but the publish flow in docs/P2P.md is all runtime:
//
//   await fetch(`hyper://localhost/?key=myapp`, { method: 'POST' })
//   await fetch(uploadUrl, { method: 'PUT', body: file })
//
// This patches fetch inside the page so those calls travel over the React
// Native bridge to the backend's own hyper fetch and come back as a real
// Response. Desktop does not need it; there hyper:// is a registered protocol.

export const HYPER_BRIDGE_REQUEST = 'peersky-hyper-fetch'
export const HYPER_BRIDGE_CHUNK = 'peersky-hyper-fetch-chunk'

// postMessage carries text, so a body crosses as base64. Chunked because one
// enormous string is what makes the bridge stall rather than transfer.
export const HYPER_BRIDGE_CHUNK_CHARACTERS = 256 * 1024
// Roughly 24 MB of file once the base64 is decoded. Past that an upload wants
// a streaming channel, not a string, and saying so beats appearing to hang.
export const HYPER_BRIDGE_MAX_BODY_CHARACTERS = 32 * 1024 * 1024

/**
 * @param {string} token Shared with the native side so a page cannot forge a
 *   reply into another page's pending request.
 */
export function createHyperBridgeScript (token) {
  return `(() => {
  if (window.__peerskyHyperBridge) return
  const TOKEN = ${JSON.stringify(String(token))}
  const CHUNK = ${HYPER_BRIDGE_CHUNK_CHARACTERS}
  const MAX_BODY = ${HYPER_BRIDGE_MAX_BODY_CHARACTERS}
  const pending = new Map()
  let nextId = 0

  const post = (payload) => {
    window.ReactNativeWebView.postMessage(JSON.stringify({ ...payload, token: TOKEN }))
  }

  const isHyper = (value) => {
    try {
      return new URL(value, document.baseURI).protocol === 'hyper:'
    } catch {
      return false
    }
  }

  const absolute = (value) => new URL(value, document.baseURI).href

  const toBase64 = (bytes) => {
    let binary = ''
    // Chunked so a large file cannot blow the argument limit of apply().
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(binary)
  }

  const fromBase64 = (value) => {
    const binary = atob(value || '')
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }

  const encodeBody = async (body) => {
    if (body === null || body === undefined || body === '') return ''
    if (typeof body === 'string') return toBase64(new TextEncoder().encode(body))
    if (body instanceof Blob) return toBase64(new Uint8Array(await body.arrayBuffer()))
    if (body instanceof ArrayBuffer) return toBase64(new Uint8Array(body))
    if (ArrayBuffer.isView(body)) {
      return toBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
    }
    if (body instanceof URLSearchParams) return toBase64(new TextEncoder().encode(String(body)))
    throw new TypeError('This body type cannot be sent over hyper:// yet')
  }

  window.__peerskyHyperBridge = {
    // Called by the native side, never by the page.
    settle (token, id, result) {
      if (token !== TOKEN) return
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      entry(result)
    }
  }

  const request = (url, init, bodyBase64) => new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)

    const send = (chunkIndex) => {
      const start = chunkIndex * CHUNK
      const slice = bodyBase64.slice(start, start + CHUNK)
      const last = start + CHUNK >= bodyBase64.length
      post({
        type: last ? ${JSON.stringify(HYPER_BRIDGE_REQUEST)} : ${JSON.stringify(HYPER_BRIDGE_CHUNK)},
        id,
        url,
        method: init.method,
        headers: init.headers,
        body: slice,
        final: last
      })
      if (!last) send(chunkIndex + 1)
    }

    if (!bodyBase64) {
      post({
        type: ${JSON.stringify(HYPER_BRIDGE_REQUEST)},
        id,
        url,
        method: init.method,
        headers: init.headers,
        body: '',
        final: true
      })
      return
    }
    send(0)
  })

  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : (input && input.url) || ''
    if (!isHyper(raw)) return nativeFetch(input, init)

    // fetch(url, init) is what the publish flow uses. A Request object carries
    // its body as a stream, which cannot be read twice, so only its method and
    // headers are taken from it.
    const options = typeof input === 'object' && input !== null
      ? { method: input.method, headers: input.headers, ...init }
      : init
    const method = String(options.method || 'GET').toUpperCase()

    let bodyBase64 = ''
    try {
      bodyBase64 = await encodeBody(options.body)
    } catch (error) {
      throw new TypeError(error && error.message ? error.message : 'Unsupported body')
    }
    if (bodyBase64.length > MAX_BODY) {
      throw new TypeError('That file is too large to send over hyper:// from the phone')
    }

    const headers = {}
    if (options.headers) {
      const entries = typeof options.headers.forEach === 'function'
        ? (() => { const out = []; options.headers.forEach((v, k) => out.push([k, v])); return out })()
        : Object.entries(options.headers)
      for (const [name, value] of entries) headers[String(name)] = String(value)
    }

    const result = await request(absolute(raw), { method, headers }, bodyBase64)
    if (!result || result.error) {
      throw new TypeError(result && result.error ? result.error : 'hyper:// request failed')
    }

    const payload = result.base64 ? fromBase64(result.body) : (result.body || '')
    return new Response(payload, {
      status: result.status || 200,
      statusText: result.statusText || '',
      headers: result.headers || {}
    })
  }
})()`
}
