/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { encodePath, folderPath, folderTitle, hyperHref, peerskyHref, routeHref } from '/hyperdrive/viewer/route.js'

// Where the viewer gets a drive's files from, and how it hands things to
// PeerSky around it.
//
// Desktop: the page is peersky://p2p/hyperdrive/..., files are read as
// hyper:// and the folder is listed through electronAPI.hyperdrive.list.
// Phone: the page comes from PeerSky's own server on 127.0.0.1, which lists
// a folder at /api/list and serves its files at /hyper/asset, both only with
// the run's token (window.peerskyViewer.token); what only the app can do
// (download, open, copy, share, the address bar) goes to it as a message.
// Every read goes to the drive being viewed, and every read is capped.

export const MAX_FILES = 50000
const ERROR_CODES = new Set(['not-found', 'no-peers', 'private', 'timeout', 'too-large', 'unknown'])

/** An Error with a `code` the shell knows how to explain. */
export function sourceError (code, message) {
  const error = new Error(message || code)
  error.code = ERROR_CODES.has(code) ? code : 'unknown'
  return error
}

function codeForStatus (status) {
  if (status === 404 || status === 410) return 'not-found'
  if (status === 401 || status === 403) return 'private'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 413) return 'too-large'
  if (status === 502 || status === 503) return 'no-peers'
  return 'unknown'
}

function abortError () {
  return new DOMException('The read was stopped.', 'AbortError')
}

// Settles with the promise, or rejects as soon as the signal aborts.
function untilAborted (promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

// mtime in milliseconds; a value that reads as seconds is scaled.
function normalizeTime (value) {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'string' && !/^\d+$/.test(value) ? Date.parse(value) : Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return number < 1e11 ? number * 1000 : number
}

/** Keeps the files under `path` that are well formed, at most MAX_FILES. */
export function normalizeListing (data, path) {
  const prefix = folderPath(path)
  const raw = Array.isArray(data && data.entries) ? data.entries : []
  const seen = new Set()
  const entries = []
  let truncated = Boolean(data && data.truncated)
  for (const item of raw) {
    if (!item || typeof item.path !== 'string') continue
    const filePath = item.path.startsWith('/') ? item.path : '/' + item.path
    if (!filePath.startsWith(prefix) || filePath.endsWith('/') || filePath.includes('\0') || seen.has(filePath)) continue
    if (entries.length >= MAX_FILES) {
      truncated = true
      break
    }
    seen.add(filePath)
    const size = Number(item.size)
    entries.push({
      path: filePath,
      size: Number.isFinite(size) && size >= 0 ? size : 0,
      mtime: normalizeTime(item.mtime)
    })
  }
  return {
    entries,
    truncated,
    private: Boolean(data && data.private === true),
    writable: Boolean(data && data.writable === true),
    // The drive's own name, when the device knows it (root listings only).
    name: data && typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 255) : null
  }
}

// Reads at most `want` bytes of a body, after skipping `skip` bytes, and
// stops the download there.
async function readCapped (response, skip, want) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const whole = await response.arrayBuffer()
    return whole.slice(skip, skip + want)
  }
  const reader = response.body.getReader()
  const out = new Uint8Array(want)
  let filled = 0
  let skipped = 0
  try {
    while (filled < want) {
      const { done, value } = await reader.read()
      if (done) break
      let chunk = value
      if (skipped < skip) {
        const drop = Math.min(skip - skipped, chunk.length)
        skipped += drop
        chunk = chunk.subarray(drop)
      }
      const take = Math.min(chunk.length, want - filled)
      out.set(chunk.subarray(0, take), filled)
      filled += take
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return filled === want ? out.buffer : out.buffer.slice(0, filled)
}

// Runs fn over items, `limit` at a time.
async function eachLimit (items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      await fn(items[index], index)
    }
  })
  await Promise.all(workers)
}

export async function createSource () {
  const desktop = window.location.protocol === 'peersky:'
  const injected = !desktop && window.peerskyViewer && typeof window.peerskyViewer === 'object' ? window.peerskyViewer : {}
  const prefersDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  const electronDrive = desktop && window.electronAPI && window.electronAPI.hyperdrive

  const platform = desktop ? 'desktop' : injected.platform === 'ios' ? 'ios' : 'android'
  // The phone's server answers only with this run's secret. It goes on
  // every /api/list and /hyper/asset address and nowhere else: never into
  // config, a message to the app, or a link that is shown, copied or shared.
  const token = !desktop && typeof injected.token === 'string' ? injected.token : ''
  const withToken = (url) => (token ? `${url}&token=${encodeURIComponent(token)}` : url)

  let epoch = 0
  if (desktop) {
    if (electronDrive && typeof electronDrive.cacheEpoch === 'function') {
      try {
        const value = await Promise.race([
          Promise.resolve(electronDrive.cacheEpoch()),
          new Promise((resolve) => setTimeout(() => resolve(0), 2000))
        ])
        epoch = Number.isFinite(Number(value)) ? Number(value) : 0
      } catch {
        epoch = 0
      }
    }
  } else if (Number.isFinite(Number(injected.epoch))) {
    epoch = Number(injected.epoch)
  }

  const safe = injected.safeArea && typeof injected.safeArea === 'object' ? injected.safeArea : null
  const config = Object.freeze({
    language: !desktop && typeof injected.language === 'string' ? injected.language : 'en',
    strings: !desktop && injected.strings && typeof injected.strings === 'object' ? injected.strings : {},
    dark: !desktop && typeof injected.dark === 'boolean' ? injected.dark : prefersDark,
    incognito: !desktop && injected.incognito === true,
    epoch,
    safeArea: safe
      ? Object.freeze({
        top: Number(safe.top) || 0,
        right: Number(safe.right) || 0,
        bottom: Number(safe.bottom) || 0,
        left: Number(safe.left) || 0
      })
      : null
  })

  function post (message) {
    try {
      if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        window.ReactNativeWebView.postMessage(JSON.stringify(message))
        return true
      }
    } catch {}
    return false
  }

  function hyperUrl (host, path) {
    return hyperHref(host, path)
  }

  function fileUrl (host, path) {
    if (desktop) return `hyper://${host}${encodePath(path)}`
    return withToken(`/hyper/asset?url=${encodeURIComponent(hyperUrl(host, path))}`)
  }

  async function listDesktop (host, path, { signal }) {
    const url = hyperUrl(host, folderPath(path))
    let result
    try {
      result = await untilAborted(Promise.resolve(electronDrive.list(url, { recursive: true })), signal)
    } catch (error) {
      if (error && error.name === 'AbortError') throw error
      throw sourceError(error && error.code, error && error.message)
    }
    if (!result || (typeof result.code === 'string' && !Array.isArray(result.entries))) {
      throw sourceError(result && result.code, result && result.message)
    }
    return normalizeListing(result, path)
  }

  // An older desktop without the list API: walk the folder as JSON listings
  // and ask each file for its size and date.
  async function walkFolder (host, path, { signal, onProgress }) {
    const root = folderPath(path)
    const folders = [root]
    const files = []
    let truncated = false

    const readFolder = async (folder) => {
      const response = await fetch(hyperUrl(host, folder) + '?noResolve', {
        headers: { Accept: 'application/json' },
        signal
      })
      if (!response.ok) {
        if (folder === root) throw sourceError(codeForStatus(response.status), response.statusText)
        return []
      }
      let names
      try {
        names = await response.json()
      } catch {
        if (folder === root) throw sourceError('unknown', 'The folder listing could not be read.')
        return []
      }
      return Array.isArray(names) ? names.filter((name) => typeof name === 'string' && name && name !== '/') : []
    }

    while (folders.length && !truncated) {
      const batch = folders.splice(0, 6)
      const results = await Promise.all(batch.map(readFolder))
      results.forEach((names, index) => {
        for (const name of names) {
          const clean = name.replace(/^\/+/, '')
          if (!clean || clean.includes('\0')) continue
          if (clean.endsWith('/')) folders.push(batch[index] + clean)
          else if (files.length < MAX_FILES) files.push(batch[index] + clean)
          else truncated = true
        }
      })
      if (onProgress) onProgress(files.length)
    }

    const entries = []
    await eachLimit(files, 6, async (filePath) => {
      if (signal && signal.aborted) throw abortError()
      let size = 0
      let mtime = null
      try {
        const response = await fetch(fileUrl(host, filePath), { method: 'HEAD', signal })
        size = Number(response.headers.get('Content-Length')) || 0
        mtime = normalizeTime(response.headers.get('Last-Modified'))
      } catch (error) {
        if (error && error.name === 'AbortError') throw error
      }
      entries.push({ path: filePath, size, mtime })
      if (onProgress && entries.length % 50 === 0) onProgress(files.length)
    })
    return normalizeListing({ entries, truncated, private: false, writable: false }, path)
  }

  async function listPhone (host, path, { signal }) {
    const url = withToken(`/api/list?url=${encodeURIComponent(hyperUrl(host, folderPath(path)))}&recursive=1`)
    let response
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' }, signal })
    } catch (error) {
      if (error && error.name === 'AbortError') throw error
      throw sourceError('unknown', error && error.message)
    }
    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }
    if (!response.ok || !data || (typeof data.code === 'string' && !Array.isArray(data.entries))) {
      throw sourceError((data && data.code) || codeForStatus(response.status), data && data.message)
    }
    return normalizeListing(data, path)
  }

  /**
   * Every file under a folder, recursively:
   * { entries: [{ path, size, mtime }], truncated, private, writable }.
   */
  function list (host, path, { signal, onProgress } = {}) {
    if (!desktop) return listPhone(host, path, { signal, onProgress })
    if (electronDrive && typeof electronDrive.list === 'function') return listDesktop(host, path, { signal, onProgress })
    return walkFolder(host, path, { signal, onProgress })
  }

  /** Bytes start to end, both included, as an ArrayBuffer. */
  async function read (host, path, start, end, { signal } = {}) {
    const first = Math.max(0, Math.floor(start))
    const last = Math.floor(end)
    const want = last - first + 1
    if (!(want > 0)) return new ArrayBuffer(0)
    const response = await fetch(fileUrl(host, path), {
      headers: { Range: `bytes=${first}-${last}` },
      signal
    })
    if (response.status === 416) {
      response.body?.cancel().catch(() => {})
      return new ArrayBuffer(0)
    }
    if (response.status !== 200 && response.status !== 206) {
      response.body?.cancel().catch(() => {})
      throw sourceError(codeForStatus(response.status), `Reading ${path} failed with ${response.status}`)
    }
    let skip = first
    if (response.status === 206) {
      const range = /bytes\s+(\d+)-/.exec(response.headers.get('Content-Range') || '')
      skip = range ? Math.max(0, first - Number(range[1])) : 0
    }
    return readCapped(response, skip, want)
  }

  /** A text file, at most maxBytes of it, as a string. */
  async function text (host, path, { maxBytes = 1024 * 1024, signal } = {}) {
    const buffer = await read(host, path, 0, maxBytes - 1, { signal })
    const bytes = new Uint8Array(buffer)
    let encoding = 'utf-8'
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
    let decoded
    try {
      // stream: true leaves out a character the cap cut in half.
      decoded = new TextDecoder(encoding).decode(bytes, { stream: true })
    } catch {
      decoded = new TextDecoder('utf-8').decode(bytes, { stream: true })
    }
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  }

  function download (host, path, name) {
    const url = hyperUrl(host, path)
    if (!desktop) return post({ type: 'download', url, name })
    if (electronDrive && typeof electronDrive.download === 'function') {
      Promise.resolve(electronDrive.download(url, name)).catch(() => {})
      return true
    }
    const link = document.createElement('a')
    link.href = url
    link.download = name || ''
    link.rel = 'noopener'
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    return true
  }

  /** Opens a link outside the viewer: http(s) or hyper only. */
  function openExternal (url) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (!['http:', 'https:', 'hyper:'].includes(parsed.protocol)) return false
    if (!desktop) return post({ type: 'open', url: parsed.href })
    window.open(parsed.href, '_blank', 'noopener')
    return true
  }

  /** A file of the drive in a new tab, as hyper://, never inside the viewer. */
  function open (host, path) {
    return openExternal(hyperUrl(host, path))
  }

  async function copy (value) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {}
    if (!desktop && post({ type: 'copy', text: value })) return true
    try {
      const area = document.createElement('textarea')
      area.value = value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      const copied = document.execCommand('copy')
      area.remove()
      return copied
    } catch {
      return false
    }
  }

  /** 'shared' on the phone; on desktop the link is copied: 'copied' or false. */
  async function share (host, path, name) {
    const url = hyperUrl(host, path)
    if (!desktop && post({ type: 'share', url, name })) return 'shared'
    return (await copy(url)) ? 'copied' : false
  }

  /** Changes the address (and the phone's address bar) to this route. */
  function setRoute (route, { replace = false, state = null, title } = {}) {
    const href = routeHref(route)
    const name = title || folderTitle(route.host, route.path)
    try {
      window.history[replace ? 'replaceState' : 'pushState'](state, '', href)
    } catch {}
    document.title = name
    if (!desktop) post({ type: 'route', url: peerskyHref(route), title: name })
  }

  return Object.freeze({
    platform,
    desktop,
    config,
    list,
    fileUrl,
    hyperUrl,
    read,
    text,
    download,
    open,
    openExternal,
    copy,
    share,
    setRoute,
    post,
    // Media from another origin needs crossorigin to be drawn to a canvas.
    crossOrigin: desktop ? 'anonymous' : null
  })
}
