/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { readImageMeta } from '/hyperdrive/viewer/lib/exif.js'
import { readVideoMeta } from '/hyperdrive/viewer/lib/video-meta.js'
import { artworkFor, parseTakeoutJson, takeoutJsonFor, wallClockOf } from '/hyperdrive/viewer/lib/sidecars.js'
import { extensionOf, kindOf } from '/hyperdrive/viewer/lib/kinds.js'
import { dateFromName, isUtcName } from '/hyperdrive/viewer/lib/names.js'

// Small pictures for grids and the hero, and what is read from inside the
// files, each kept in the store so a folder opens fast the next time.
//
// A photo: the cached picture; else the preview the camera wrote into the
// file (one ranged read, turned upright); else the whole file when this
// engine can draw it, made small on a canvas; else nothing, and the grid
// shows the format (HEIC, RAW, TIFF). A video: the cached picture; else the
// cover inside an MP4 or MKV; else a poster or thumb next to it; else a
// frame from the video itself.
//
// Jobs wait in small queues, the newest first, and stop when what asked for
// them scrolls away.

const GRID = 320
const HERO = 1280
const VIDEO_GRID = 480
const QUALITY = 0.82
const MAX_WHOLE_IMAGE = 40 * 1024 * 1024
const MAX_EMBEDDED = 16 * 1024 * 1024
const MAX_TAKEOUT_JSON = 256 * 1024
const FRAME_TIMEOUT = 15000
const URL_CACHE = 1500
// Part of every cache key: a new number when the way pictures are made or
// files are read changes, so nothing kept from before is used.
const CACHE_VERSION = 2

const RAW = new Set(['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mrw'])
const ALWAYS_DRAWN = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'avif', 'bmp'])
// Safari draws these; Chromium does not.
const APPLE_DRAWN = new Set(['heic', 'heif', 'tif', 'tiff'])

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

export function abortError () {
  return new DOMException('Stopped', 'AbortError')
}

export function isAbort (error) {
  return Boolean(error) && error.name === 'AbortError'
}

/**
 * A queue running `concurrency` jobs at a time. 'high' jobs run newest
 * first; 'low' jobs run in order, only when no high job waits. A job whose
 * signal aborts before it starts never runs.
 */
export function createQueue (concurrency) {
  const high = []
  const low = []
  let running = 0

  function pump () {
    while (running < concurrency && (high.length || low.length)) {
      const job = high.length ? high.pop() : low.shift()
      if (job.signal && job.signal.aborted) {
        job.reject(abortError())
        continue
      }
      running++
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          running--
          pump()
        })
    }
  }

  // A ticket: { promise, promote() }. promote() moves a waiting low job up.
  function add (run, { signal, priority = 'high' } = {}) {
    let job = null
    const promise = new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(abortError())
        return
      }
      job = { run, resolve, reject, signal }
      if (signal) {
        signal.addEventListener('abort', () => {
          for (const lane of [high, low]) {
            const at = lane.indexOf(job)
            if (at !== -1) {
              lane.splice(at, 1)
              reject(abortError())
            }
          }
        }, { once: true })
      }
      ;(priority === 'low' ? low : high).push(job)
      pump()
    })
    return {
      promise,
      promote () {
        const at = job ? low.indexOf(job) : -1
        if (at === -1) return
        low.splice(at, 1)
        high.push(job)
        pump()
      }
    }
  }

  return {
    add,
    push: (run, options) => add(run, options).promise,
    get size () {
      return high.length + low.length + running
    }
  }
}

/**
 * Runs one job per key however many ask for it. Each asker may stop
 * waiting with its own signal; the job itself stops only when every asker
 * has. run(signal) gets the job's own signal.
 */
export function createShared () {
  const jobs = new Map()
  return function shared (key, queue, run, { signal, priority = 'high' } = {}) {
    let job = jobs.get(key)
    if (!job) {
      const controller = new AbortController()
      const ticket = queue.add(() => run(controller.signal), { signal: controller.signal, priority })
      job = { controller, ticket, waiting: 0 }
      jobs.set(key, job)
      const forget = () => {
        if (jobs.get(key) === job) jobs.delete(key)
      }
      ticket.promise.then(forget, forget)
    } else if (priority !== 'low') {
      job.ticket.promote()
    }
    const current = job
    current.waiting++
    return new Promise((resolve, reject) => {
      let settled = false
      const leave = () => {
        if (settled) return
        settled = true
        current.waiting--
        if (current.waiting <= 0) {
          current.controller.abort()
          if (jobs.get(key) === current) jobs.delete(key)
        }
        reject(abortError())
      }
      if (signal) {
        if (signal.aborted) {
          leave()
          return
        }
        signal.addEventListener('abort', leave, { once: true })
      }
      current.ticket.promise.then((value) => {
        if (settled) return
        settled = true
        current.waiting--
        if (signal) signal.removeEventListener('abort', leave)
        resolve(value)
      }, (error) => {
        if (settled) return
        settled = true
        current.waiting--
        if (signal) signal.removeEventListener('abort', leave)
        reject(error)
      })
    })
  }
}

function canvasToBlob (canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be saved'))), 'image/jpeg', QUALITY)
    } catch (error) {
      // A canvas holding a picture from another origin cannot be read.
      reject(error)
    }
  })
}

/**
 * Draws a picture small. mode 'cover' makes the short side `target` (for
 * square grids), 'contain' the long side. orientation is EXIF's 1 to 8, for
 * pictures that are not upright by themselves.
 */
export async function drawSmall (picture, target, { mode = 'cover', orientation = 1, background } = {}) {
  const turned = orientation >= 5 && orientation <= 8
  const width = turned ? picture.height : picture.width
  const height = turned ? picture.width : picture.height
  if (!width || !height) throw new Error('The picture has no size')
  let scale = mode === 'cover' ? target / Math.min(width, height) : target / Math.max(width, height)
  if (mode === 'cover' && Math.max(width, height) * scale > target * 3) scale = (target * 3) / Math.max(width, height)
  scale = Math.min(1, scale)
  const outWidth = Math.max(1, Math.round(width * scale))
  const outHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const context = canvas.getContext('2d')
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, outWidth, outHeight)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  switch (orientation) {
    case 2: context.transform(-1, 0, 0, 1, outWidth, 0); break
    case 3: context.transform(-1, 0, 0, -1, outWidth, outHeight); break
    case 4: context.transform(1, 0, 0, -1, 0, outHeight); break
    case 5: context.transform(0, 1, 1, 0, 0, 0); break
    case 6: context.transform(0, 1, -1, 0, outWidth, 0); break
    case 7: context.transform(0, -1, -1, 0, outWidth, outHeight); break
    case 8: context.transform(0, -1, 1, 0, 0, outHeight); break
    default: break
  }
  context.drawImage(picture.image, 0, 0, turned ? outHeight : outWidth, turned ? outWidth : outHeight)
  const blob = await canvasToBlob(canvas)
  canvas.width = 0
  canvas.height = 0
  return blob
}

/**
 * A JPEG without its own EXIF (APP1) segments, as a Blob. An EXIF or RAW
 * preview is stored the way the sensor saw it and turned by the file's
 * Orientation; some carry an Orientation of their own, which a decoder would
 * apply as well. Without it the picture decodes as stored in every engine,
 * and is turned exactly once.
 */
export function withoutOwnExif (buffer, type = 'image/jpeg') {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return new Blob([bytes], { type })
  const parts = [bytes.subarray(0, 2)]
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]
    // Start of scan: the rest is image data.
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      parts.push(bytes.subarray(at, at + 2))
      at += 2
      continue
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    if (length < 2 || at + 2 + length > bytes.length) break
    const exif = marker === 0xe1 && bytes[at + 4] === 0x45 && bytes[at + 5] === 0x78 && bytes[at + 6] === 0x69 && bytes[at + 7] === 0x66
    if (!exif) parts.push(bytes.subarray(at, at + 2 + length))
    at += 2 + length
  }
  parts.push(bytes.subarray(at))
  return new Blob(parts, { type })
}

/** A Blob decoded into something drawImage takes: { image, width, height, close() }. */
export async function decodePicture (blob, hint = {}) {
  if (typeof createImageBitmap === 'function') {
    const attempts = [{ imageOrientation: 'from-image', ...hint }, { imageOrientation: 'from-image' }, undefined]
    for (const options of attempts) {
      try {
        const bitmap = options ? await createImageBitmap(blob, options) : await createImageBitmap(blob)
        return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
      } catch {}
    }
  }
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
}

/**
 * The thumbnail maker for one drive.
 * @param {{ source: object, store: object, host: string }} options
 */
export function createThumbs ({ source, store, host }) {
  const photoQueue = createQueue(4)
  const videoQueue = createQueue(2)
  const metaQueue = createQueue(4)
  const urls = new Map()
  const missing = new Set()
  const metaMemo = new Map()
  const shared = createShared()

  // Formats this engine turned out not to draw, so their originals are not
  // fetched again this visit (HEIC on an older iOS, TIFF).
  const undrawable = new Set()
  const drawable = (path) => {
    const extension = extensionOf(path)
    if (ALWAYS_DRAWN.has(extension)) return true
    return APPLE_DRAWN.has(extension) && source.platform === 'ios' && !undrawable.has(extension)
  }
  const cannotDraw = (path) => {
    const extension = extensionOf(path)
    if (APPLE_DRAWN.has(extension)) undrawable.add(extension)
  }

  function remember (key, blob) {
    const url = URL.createObjectURL(blob)
    urls.set(key, url)
    while (urls.size > URL_CACHE) {
      const [oldKey, oldUrl] = urls.entries().next().value
      urls.delete(oldKey)
      URL.revokeObjectURL(oldUrl)
    }
    return url
  }

  function recall (key) {
    const url = urls.get(key)
    if (!url) return null
    urls.delete(key)
    urls.set(key, url)
    return url
  }

  async function cachedMeta (entry, kind, read, { signal, priority } = {}) {
    const key = `${store.keyOf(entry)}|${kind}${CACHE_VERSION}`
    if (metaMemo.has(key)) return metaMemo.get(key)
    return shared(key, metaQueue, async (jobSignal) => {
      const stored = await store.getMeta(key).catch(() => null)
      if (stored) {
        const value = stored.value === undefined ? null : stored.value
        metaMemo.set(key, value)
        return value
      }
      const at = (start, end) => source.read(host, entry.path, start, end, { signal: jobSignal })
      try {
        const value = await read(at, { size: entry.size, name: entry.path.split('/').pop() })
        const kept = value && typeof value === 'object' ? value : null
        metaMemo.set(key, kept)
        store.putMeta(key, { value: kept }).catch(() => {})
        return kept
      } catch (error) {
        // A network failure is tried again next time; a file that cannot be
        // read is remembered as such.
        if (isAbort(error) || error.code || error instanceof TypeError) throw error
        metaMemo.set(key, null)
        store.putMeta(key, { value: null }).catch(() => {})
        return null
      }
    }, { signal, priority })
  }

  /** What a photo's file says about it (lib/exif.js), cached. Null when unknown. */
  function imageMeta (entry, options) {
    return cachedMeta(entry, 'exif', readImageMeta, options)
  }

  /** What a video's file says about it (lib/video-meta.js), cached. */
  function videoMeta (entry, options) {
    return cachedMeta(entry, 'video', readVideoMeta, options)
  }

  // A picture stored inside the file. A preview (preview: true) is decoded
  // as stored, its own EXIF left out, for the caller to turn once by the
  // file's Orientation; a cover decodes as it is.
  async function embeddedPicture (entry, part, type, signal, { preview = false } = {}) {
    if (!part || !(part.length > 0) || part.length > MAX_EMBEDDED || !(part.offset >= 0)) return null
    if (entry.size && part.offset + part.length > entry.size) return null
    const bytes = await source.read(host, entry.path, part.offset, part.offset + part.length - 1, { signal })
    if (bytes.byteLength < part.length) return null
    const blob = preview ? withoutOwnExif(bytes, type || 'image/jpeg') : new Blob([bytes], { type: type || 'image/jpeg' })
    try {
      return await decodePicture(blob)
    } catch {
      return null
    }
  }

  async function wholePicture (entry, target, meta, signal) {
    const bytes = await source.read(host, entry.path, 0, entry.size - 1, { signal })
    const blob = new Blob([bytes], { type: MIME[extensionOf(entry.path)] || 'application/octet-stream' })
    // Decoding straight to about the size wanted saves memory on big photos.
    // Only for upright files: some engines size before they turn.
    const hint = {}
    const orientation = meta && meta.orientation
    if (meta && meta.width && meta.height && (!orientation || orientation <= 4)) {
      const short = Math.min(meta.width, meta.height)
      if (short > target * 1.5) {
        if (meta.width <= meta.height) hint.resizeWidth = Math.round(target * 1.25)
        else hint.resizeHeight = Math.round(target * 1.25)
        hint.resizeQuality = 'high'
      }
    }
    return decodePicture(blob, hint)
  }

  // A Blob, a URL to show as is, or null.
  async function makePhoto (entry, target, mode, signal) {
    let meta = null
    try {
      meta = await imageMeta(entry, { signal })
    } catch (error) {
      if (isAbort(error)) throw error
    }
    const canDraw = drawable(entry.path) && entry.size > 0 && entry.size <= MAX_WHOLE_IMAGE
    let preview = null
    try {
      preview = await embeddedPicture(entry, meta && meta.thumbnail, 'image/jpeg', signal, { preview: true })
    } catch (error) {
      if (isAbort(error)) throw error
    }
    // Only the preview, stored the way the sensor saw it, is turned here,
    // once, by the file's Orientation (for HEIF, its irot and imir). A whole
    // image the engine decodes is upright already and never turned again.
    const orientation = (meta && meta.orientation) || 1
    try {
      if (preview) {
        const short = Math.min(preview.width, preview.height)
        const long = Math.max(preview.width, preview.height)
        const goodEnough = mode === 'cover' ? short >= target * 0.75 : long >= target * 0.75
        if (goodEnough || !canDraw) {
          return await drawSmall(preview, target, { mode, orientation, background: '#ffffff' })
        }
      }
      if (canDraw) {
        let whole = null
        try {
          whole = await wholePicture(entry, target, meta, signal)
        } catch (error) {
          if (isAbort(error)) throw error
          // On desktop a drive another origin will not share bytes with the
          // page draws as it is.
          if (error instanceof TypeError && source.desktop) return source.fileUrl(host, entry.path)
          if (!error.code) cannotDraw(entry.path)
        }
        if (whole) {
          try {
            return await drawSmall(whole, target, { mode, background: '#ffffff' })
          } finally {
            whole.close()
          }
        }
      }
      if (preview) return await drawSmall(preview, target, { mode, orientation, background: '#ffffff' })
    } finally {
      if (preview) preview.close()
    }
    return null
  }

  function frameAt (duration) {
    if (!Number.isFinite(duration) || duration <= 0) return 1
    if (duration < 10) return Math.min(1, duration / 2)
    return Math.min(duration * 0.1, 30)
  }

  // A frame from the video itself, with a hidden muted <video>.
  function videoFrame (entry, target, signal) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      video.muted = true
      video.defaultMuted = true
      video.playsInline = true
      video.preload = 'metadata'
      video.setAttribute('muted', '')
      video.setAttribute('playsinline', '')
      if (source.crossOrigin) video.crossOrigin = source.crossOrigin
      let settled = false
      const finish = (value, error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', onAbort)
        video.removeAttribute('src')
        try {
          video.load()
        } catch {}
        if (error) reject(error)
        else resolve(value)
      }
      const onAbort = () => finish(null, abortError())
      const timer = setTimeout(() => finish(null), FRAME_TIMEOUT)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      video.addEventListener('loadedmetadata', () => {
        try {
          video.currentTime = frameAt(video.duration)
        } catch {
          finish(null)
        }
      }, { once: true })
      video.addEventListener('seeked', () => {
        const draw = async () => {
          if (settled) return
          try {
            const picture = { image: video, width: video.videoWidth, height: video.videoHeight }
            if (!picture.width || !picture.height) return finish(null)
            finish(await drawSmall(picture, target, { mode: 'contain' }))
          } catch {
            finish(null)
          }
        }
        // Some engines have the frame only once it has been shown.
        if (typeof video.requestVideoFrameCallback === 'function') {
          let drawn = false
          const once = () => {
            if (drawn) return
            drawn = true
            draw()
          }
          video.requestVideoFrameCallback(once)
          setTimeout(once, 400)
        } else {
          setTimeout(draw, 60)
        }
      }, { once: true })
      video.addEventListener('error', () => finish(null), { once: true })
      video.src = source.fileUrl(host, entry.path)
    })
  }

  async function artworkPicture (entries, path, target, mode, signal) {
    if (!path) return null
    const art = entries.find((item) => item.path === path)
    if (!art) return null
    const made = await makePhoto(art, target, mode, signal)
    return made
  }

  async function makeVideo (entry, target, { entries, prefer, signal }) {
    let art = null
    if (entries) {
      try {
        art = await artworkFor(entry.path, entries)
      } catch {
        art = null
      }
    }
    const fromCover = async () => {
      let meta = null
      try {
        meta = await videoMeta(entry, { signal })
      } catch (error) {
        if (isAbort(error)) throw error
      }
      const cover = await embeddedPicture(entry, meta && meta.cover, meta && meta.cover && meta.cover.type, signal)
      if (!cover) return null
      try {
        return await drawSmall(cover, target, { mode: 'contain' })
      } finally {
        cover.close()
      }
    }
    const list = entries || []
    // A 16:9 card wants the video's own still, then a frame; a poster card
    // wants the cover or poster first (thumb is the episode's own still,
    // backdrop the show's or movie's wide art).
    const steps = prefer === 'frame'
      ? [() => artworkPicture(list, art && art.thumb, target, 'contain', signal),
          () => videoFrame(entry, target, signal),
          () => artworkPicture(list, art && art.backdrop, target, 'contain', signal),
          fromCover,
          () => artworkPicture(list, art && art.poster, target, 'contain', signal)]
      : [fromCover,
          () => artworkPicture(list, art && (art.poster || art.thumb), target, 'contain', signal),
          () => videoFrame(entry, target, signal),
          () => artworkPicture(list, art && art.backdrop, target, 'contain', signal)]
    for (const step of steps) {
      try {
        const made = await step()
        if (made) return made
      } catch (error) {
        if (isAbort(error)) throw error
      }
    }
    return null
  }

  async function picture (key, make, queue, { signal, priority }) {
    const known = recall(key)
    if (known) return known
    if (missing.has(key)) return null
    return shared(key, queue, async (jobSignal) => {
      const blob = await store.getThumb(key).catch(() => null)
      if (blob) return recall(key) || remember(key, blob)
      const made = await make(jobSignal)
      if (!made) {
        missing.add(key)
        return null
      }
      if (typeof made === 'string') return made
      store.putThumb(key, made).catch(() => {})
      return recall(key) || remember(key, made)
    }, { signal, priority })
  }

  /**
   * A photo's small picture as an object URL, or null. size: 'grid' (320 px
   * on the short side, for square crops) or 'hero' (1280 px on the long side).
   */
  function photo (entry, { size = 'grid', signal, priority } = {}) {
    const target = size === 'hero' ? HERO : GRID
    const mode = size === 'hero' ? 'contain' : 'cover'
    const key = `${store.keyOf(entry)}|p${target}.${CACHE_VERSION}`
    return picture(key, (jobSignal) => makePhoto(entry, target, mode, jobSignal), photoQueue, { signal, priority })
  }

  /**
   * A video's picture as an object URL, or null. size: 'grid' (480 px wide)
   * or 'hero' (1280). prefer: 'poster' (cover or poster first, the default)
   * or 'frame' (a 16:9 backdrop or a frame first). entries: the listing, for
   * artwork next to the video.
   */
  function video (entry, { size = 'grid', signal, priority, entries, prefer = 'poster' } = {}) {
    const target = size === 'hero' ? HERO : VIDEO_GRID
    const key = `${store.keyOf(entry)}|v${target}${prefer === 'frame' ? 'f' : ''}.${CACHE_VERSION}`
    return picture(key, (jobSignal) => makeVideo(entry, target, { entries, prefer, signal: jobSignal }), videoQueue, { signal, priority })
  }

  /** The format to show on a tile that has no picture: HEIC, RAW, TIFF... */
  function badge (entry) {
    const extension = extensionOf(entry.path)
    if (extension === 'heic' || extension === 'heif') return 'HEIC'
    if (RAW.has(extension) || kindOf(entry.path, entry.size) === 'raw') return 'RAW'
    if (extension === 'tif' || extension === 'tiff') return 'TIFF'
    return extension ? extension.toUpperCase().slice(0, 5) : ''
  }

  /** True when this engine can show the original image itself. */
  function canShowOriginal (entry) {
    return drawable(entry.path)
  }

  /** The original did not show: its format is not tried again this visit. */
  function originalFailed (entry) {
    cannotDraw(entry.path)
  }

  /**
   * When a photo or clip was taken: { ms, utc: true, source }, ms being the
   * wall-clock time where it was taken as Date.UTC(...), so format it with
   * timeZone 'UTC'. In order: EXIF (or the video's own date), Google Takeout
   * JSON, the file name, the drive's mtime (both real instants, turned into
   * this device's wall-clock time). source: 'exif', 'video', 'takeout',
   * 'name', 'mtime', or 'none' with ms null. entries: the listing, for
   * Takeout JSON. A read that fails is not remembered.
   */
  async function takenAt (entry, { entries, signal, priority } = {}) {
    const key = `${store.keyOf(entry)}|time${CACHE_VERSION}`
    if (metaMemo.has(key)) return metaMemo.get(key)
    const stored = await store.getMeta(key).catch(() => null)
    if (stored && stored.value) {
      metaMemo.set(key, stored.value)
      return stored.value
    }
    const kind = kindOf(entry.path, entry.size)
    let result = null
    let offset = null
    let failed = false
    try {
      if (kind === 'video') {
        const meta = await videoMeta(entry, { signal, priority })
        // A real instant; the file's own offset gives the time where it was
        // filmed, else this device's.
        if (meta && Number.isFinite(meta.created)) result = { ms: wallClockOf(meta.created, Number.isFinite(meta.offset) ? meta.offset : null), utc: true, source: 'video' }
      } else {
        const meta = await imageMeta(entry, { signal, priority })
        if (meta && Number.isFinite(meta.offset)) offset = meta.offset
        if (meta && Number.isFinite(meta.taken)) result = { ms: meta.taken, utc: true, source: 'exif' }
      }
    } catch (error) {
      if (isAbort(error)) throw error
      failed = true
    }
    if (!result && entries) {
      const jsonPath = takeoutJsonFor(entry.path, entries)
      if (jsonPath) {
        try {
          const text = await source.text(host, jsonPath, { maxBytes: MAX_TAKEOUT_JSON, signal })
          const takeout = parseTakeoutJson(text)
          if (takeout && Number.isFinite(takeout.taken)) result = { ms: wallClockOf(takeout.taken, offset), utc: true, source: 'takeout' }
        } catch (error) {
          if (isAbort(error)) throw error
          failed = true
        }
      }
    }
    if (!result) {
      const name = entry.path.split('/').pop()
      const named = dateFromName(name)
      // Most names hold wall-clock time; a Pixel's holds UTC, turned into
      // wall-clock time the way a Takeout time is.
      if (Number.isFinite(named)) result = { ms: isUtcName(name) ? wallClockOf(named, offset) : named, utc: true, source: 'name' }
    }
    if (!result && Number.isFinite(entry.mtime)) result = { ms: wallClockOf(entry.mtime, null), utc: true, source: 'mtime' }
    if (!result) result = { ms: null, utc: true, source: 'none' }
    if (!failed) {
      metaMemo.set(key, result)
      store.putMeta(key, { value: result }).catch(() => {})
    }
    return result
  }

  // Elements waiting for a picture while they are near the screen.
  const records = new Map()
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((changes) => {
      for (const change of changes) {
        const record = records.get(change.target)
        if (!record || record.done) continue
        if (change.isIntersecting) start(record)
        else stop(record)
      }
    }, { rootMargin: '400px' })
    : null

  function start (record) {
    if (record.controller) return
    const controller = new AbortController()
    record.controller = controller
    const { kind = 'photo', size = 'grid', entries, prefer } = record.options
    const job = kind === 'video'
      ? video(record.entry, { size, entries, prefer, signal: controller.signal })
      : photo(record.entry, { size, signal: controller.signal })
    job.then((url) => {
      if (record.controller !== controller) return
      record.done = true
      record.controller = null
      if (observer) observer.unobserve(record.element)
      show(record, url)
    }, (error) => {
      if (record.controller === controller) record.controller = null
      if (isAbort(error)) return
      record.done = true
      if (observer) observer.unobserve(record.element)
      show(record, null)
    })
  }

  function stop (record) {
    if (!record.controller) return
    record.controller.abort()
    record.controller = null
  }

  function show (record, url) {
    const { element, options } = record
    if (options.onResult) {
      options.onResult(url)
      return
    }
    if (url && element.tagName === 'IMG') {
      element.addEventListener('load', () => element.classList.add('is-loaded'), { once: true })
      element.addEventListener('error', () => element.classList.add('is-missing'), { once: true })
      element.setAttribute('src', url)
    } else {
      element.classList.add('is-missing')
    }
  }

  /**
   * Fills an <img> with an entry's picture once it is near the screen.
   * options: { kind: 'photo' | 'video', size, entries, prefer, onResult(url) }.
   * Returns a function that stops it.
   */
  function attach (element, entry, options = {}) {
    detach(element)
    const record = { element, entry, options, controller: null, done: false }
    records.set(element, record)
    if (observer) observer.observe(element)
    else start(record)
    return () => detach(element)
  }

  function detach (element) {
    const record = records.get(element)
    if (!record) return
    stop(record)
    records.delete(element)
    if (observer) observer.unobserve(element)
  }

  /** Stops every picture asked for inside an element, before it is emptied. */
  function detachWithin (container) {
    for (const element of [...records.keys()]) {
      if (container.contains(element)) detach(element)
    }
  }

  /** Stops everything; cached pictures stay for the next view. */
  function stopAll () {
    for (const element of [...records.keys()]) detach(element)
  }

  return Object.freeze({
    photo,
    video,
    imageMeta,
    videoMeta,
    takenAt,
    badge,
    canShowOriginal,
    originalFailed,
    attach,
    detach,
    detachWithin,
    stopAll,
    queue: createQueue
  })
}
