// What each file in a drive is, and which view a folder opens in. Pure: no
// DOM and no network, so the viewer and node --test run the same code.

const TABLE = {
  image: 'jpg jpeg jpe jfif png gif webp avif heic heif bmp tif tiff',
  raw: 'dng cr2 cr3 nef nrw arw srf sr2 orf rw2 raf pef srw x3f 3fr erf kdc mrw',
  video: 'mp4 m4v mov qt webm mkv avi wmv flv 3gp 3g2 ts mts m2ts mpg mpeg ogv',
  audio: 'mp3 m4a aac flac wav ogg oga opus wma aiff aif alac',
  subtitle: 'srt vtt ass ssa sub idx sup',
  text: 'txt log csv tsv json xml yaml yml ini',
  markdown: 'md markdown',
  pdf: 'pdf',
  html: 'html htm xhtml',
  svg: 'svg',
  archive: 'zip rar 7z tar gz tgz bz2 xz',
  document: 'doc docx odt rtf pages key numbers xls xlsx ods ppt pptx odp epub',
  code: 'js mjs ts tsx jsx css py rb go rs java c h cpp swift kt sh',
  font: 'ttf otf woff woff2'
}

/** Extensions by kind. A file whose extension is in none of them is 'other'. */
export const KINDS = Object.freeze(Object.fromEntries(
  Object.entries(TABLE).map(([kind, list]) => [kind, Object.freeze(list.split(' '))])
))

// The first kind listed wins, so .ts is a video before it is code.
const KIND_OF_EXTENSION = new Map()
for (const [kind, list] of Object.entries(KINDS)) {
  for (const extension of list) if (!KIND_OF_EXTENSION.has(extension)) KIND_OF_EXTENSION.set(extension, kind)
}

// A .ts is an MPEG transport stream or TypeScript. Source files are small and
// recordings are not, so a small one, or a .d.ts, is code.
const TS_CODE_LIMIT = 512 * 1024

// A Live Photo's motion part is about 3 seconds long. A bigger .mov or .mp4
// is a video of its own, and an image with its name is its poster.
const LIVE_PHOTO_MAX = 15 * 1024 * 1024

const JUNK_NAMES = new Set(['thumbs.db', 'desktop.ini', '__macosx', '@eadir', '$recycle.bin', 'system volume information'])
const PHOTO_SIDECARS = new Set(['xmp', 'aae'])
// .thm and .lrv are the thumbnails and small copies action cameras write.
const VIDEO_SIDECARS = new Set(['nfo', 'thm', 'lrv'])
const ARTWORK_NAMES = new Set('poster folder cover fanart backdrop banner logo clearart clearlogo thumb landscape background disc discart'.split(' '))
const SEASON_ARTWORK = /^season(\d+|-all|-specials)(-poster|-banner|-fanart|-landscape|-thumb)?$/
const ARTWORK_SUFFIX = /-(poster|fanart|thumb|banner|landscape|clearart|clearlogo|discart|logo)$/
const SUBS_FOLDER = /^(subs|subtitles)$/i

/** The last part of a path: the file or folder name. */
export function fileName (path) {
  const text = String(path ?? '')
  const end = text.endsWith('/') ? text.length - 1 : text.length
  return text.slice(text.lastIndexOf('/', end - 1) + 1, end)
}

/** The folder a path is in, ending in '/': '/a/b.jpg' is in '/a/'. */
export function folderOf (path) {
  const text = String(path ?? '')
  const end = text.endsWith('/') ? text.length - 1 : text.length
  return text.slice(0, text.lastIndexOf('/', end - 1) + 1) || '/'
}

/** The extension in lower case without the dot, or '' (a dot file has none). */
export function extensionOf (path) {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** The file name without its folder and extension. */
export function baseName (path) {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * The kind of a file by its extension: image, raw, video, audio, subtitle,
 * text, markdown, pdf, html, svg, archive, document, code, font or other.
 * Pass the size when known: it tells a .ts video from TypeScript.
 */
export function kindOf (path, size) {
  const extension = extensionOf(path)
  const kind = KIND_OF_EXTENSION.get(extension) || 'other'
  if (extension === 'ts' && (/\.d\.ts$/i.test(fileName(path)) || (Number.isFinite(size) && size < TS_CODE_LIMIT))) return 'code'
  return kind
}

/** Raw photos count as images. */
export function isImageKind (kind) {
  return kind === 'image' || kind === 'raw'
}

/** Dot files and folders, and what Windows, macOS and NAS boxes leave behind. */
export function isJunk (path) {
  for (const segment of String(path ?? '').split('/')) {
    if (segment && (segment.startsWith('.') || JUNK_NAMES.has(segment.toLowerCase()))) return true
  }
  return false
}

let collator = null

/** Names in the order people expect: 'IMG 2' before 'IMG 10', case aside. */
export function naturalCompare (a, b) {
  const x = String(a ?? '')
  const y = String(b ?? '')
  collator = collator || new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return collator.compare(x, y) || (x < y ? -1 : x > y ? 1 : 0)
}

function utf8Length (text) {
  let length = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // Each half of a surrogate pair is 2 of its 4 bytes.
    length += code < 0x80 ? 1 : code < 0x800 || (code >= 0xd800 && code < 0xe000) ? 2 : 3
  }
  return length
}

/**
 * The media files of one folder, for takeoutTarget(). names are lower-case
 * file names of its images, raw photos and videos.
 */
export function takeoutIndex (names) {
  const index = { names: new Set(), bases: new Map(), sorted: null }
  for (const name of names) {
    const lower = String(name).toLowerCase()
    index.names.add(lower)
    const base = baseName(lower)
    if (!index.bases.has(base)) index.bases.set(base, lower)
  }
  return index
}

/**
 * Which media file in the same folder a Google Takeout JSON describes, as its
 * lower-case name, or null: IMG_1.jpg.json, IMG_1.jpg.supplemental-metadata.json
 * and any other <media name>*.json, IMG_1.jpg(1).json for IMG_1(1).jpg,
 * IMG_1.json, and Takeout's long names cut to 46 characters.
 */
export function takeoutTarget (jsonName, index) {
  const lower = String(jsonName ?? '').toLowerCase()
  // Takeout's JSON names are short; a long one is someone else's.
  if (!lower.endsWith('.json') || lower.length > 512 || !index || !index.names.size) return null
  let base = lower.slice(0, -5)
  let copy = ''
  const counter = /\(\d{1,4}\)$/.exec(base)
  if (counter) {
    copy = counter[0]
    base = base.slice(0, counter.index)
  }
  for (let dot = base.indexOf('.', 1), tries = 0; dot !== -1 && tries < 16; dot = base.indexOf('.', dot + 1), tries++) {
    const extension = /^[a-z0-9]+/.exec(base.slice(dot + 1, dot + 12))
    if (!extension) continue
    const stem = base.slice(0, dot)
    const suffix = '.' + extension[0]
    for (const name of [copy && stem + copy + suffix, stem + suffix, stem + '-edited' + suffix]) {
      if (name && index.names.has(name)) return name
    }
  }
  const same = (copy && index.bases.get(base + copy)) || index.bases.get(base)
  if (same) return same
  // A cut name is 46 characters long, or near 46 bytes when cut by bytes.
  if (utf8Length(base) >= 43) {
    const sorted = index.sorted || (index.sorted = [...index.names].sort())
    let low = 0
    let high = sorted.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (sorted[middle] < base) low = middle + 1
      else high = middle
    }
    if (low < sorted.length && sorted[low].startsWith(base)) return sorted[low]
  }
  return null
}

const indexes = new WeakMap()

/**
 * The listing by folder: files maps each folder ('/a/') to the entries
 * directly in it, folders to the names of the folders directly in it. Kept
 * per entries array and made again when its length changes, so asking for
 * each of 20,000 items costs one pass.
 */
export function folderIndex (entries) {
  const list = Array.isArray(entries) ? entries : []
  const held = indexes.get(list)
  if (held && held.length === list.length) return held
  const index = { length: list.length, files: new Map(), folders: new Map() }
  for (const entry of list) {
    const path = entry && typeof entry.path === 'string' ? entry.path : ''
    if (!path || path.endsWith('/')) continue
    const folder = folderOf(path)
    const files = index.files.get(folder)
    if (files) files.push(entry)
    else index.files.set(folder, [entry])
    // Every folder above it, each under its parent.
    for (let dir = folder; dir !== '/' && dir; dir = folderOf(dir)) {
      const parent = folderOf(dir)
      const names = index.folders.get(parent)
      const name = fileName(dir)
      if (names && names.has(name)) break
      if (names) names.add(name)
      else index.folders.set(parent, new Set([name]))
    }
  }
  if (Array.isArray(entries)) indexes.set(entries, index)
  return index
}

function normalizeFolder (folderPath) {
  let folder = typeof folderPath === 'string' && folderPath ? folderPath : '/'
  if (!folder.startsWith('/')) folder = '/' + folder
  if (!folder.endsWith('/')) folder += '/'
  return folder
}

function parentOf (dir) {
  if (dir === '/' || !dir) return ''
  return dir.slice(0, dir.lastIndexOf('/', dir.length - 2) + 1)
}

function isArtworkName (base, videoBases) {
  if (ARTWORK_NAMES.has(base) || SEASON_ARTWORK.test(base)) return true
  if (!videoBases) return false
  if (videoBases.has(base)) return true
  const suffix = ARTWORK_SUFFIX.exec(base)
  return Boolean(suffix && videoBases.has(base.slice(0, suffix.index)))
}

// Movie/Subs/x.srt and Movie/Subs/Movie/x.srt belong to the videos in Movie/.
function inSubsFolder (dir, videoDirs) {
  const parts = dir.split('/')
  for (let i = parts.length - 2; i >= 1 && i >= parts.length - 3; i--) {
    if (SUBS_FOLDER.test(parts[i]) && videoDirs.has(parts.slice(0, i).join('/') + '/')) return true
  }
  return false
}

function analyze (entries, folderPath) {
  const folder = normalizeFolder(folderPath)
  const files = []
  const dirs = new Map()
  let junk = 0
  let hasSite = false
  for (const entry of Array.isArray(entries) ? entries : []) {
    const given = entry && typeof entry.path === 'string' ? entry.path : ''
    if (!given || given.endsWith('/')) continue
    const path = given.startsWith('/') ? given : '/' + given
    if (!path.startsWith(folder)) continue
    const relative = path.slice(folder.length)
    if (relative === 'index.html' || relative === 'index.htm') hasSite = true
    if (isJunk(relative)) {
      junk++
      continue
    }
    const slash = path.lastIndexOf('/')
    const name = path.slice(slash + 1)
    const file = {
      path: given,
      dir: path.slice(0, slash + 1),
      name,
      lower: name.toLowerCase(),
      base: baseName(name).toLowerCase(),
      extension: extensionOf(name),
      kind: kindOf(name, entry.size),
      size: entry.size
    }
    files.push(file)
    const group = dirs.get(file.dir)
    if (group) group.push(file)
    else dirs.set(file.dir, [file])
  }

  // Live Photos: a short .mov or .mp4 named like an image in its folder.
  const pairs = new Map()
  const motion = new Set()
  for (const group of dirs.values()) {
    const clips = new Map()
    for (const file of group) {
      if ((file.extension !== 'mov' && file.extension !== 'mp4') || file.size > LIVE_PHOTO_MAX) continue
      const held = clips.get(file.base)
      if (!held || (held.extension !== 'mov' && file.extension === 'mov')) clips.set(file.base, file)
    }
    if (!clips.size) continue
    for (const file of group) {
      const clip = isImageKind(file.kind) && clips.get(file.base)
      if (clip) {
        pairs.set(file.path, clip.path)
        motion.add(clip.path)
      }
    }
  }

  // Folders with videos in them or below them, and each folder's video names.
  const videoDirs = new Set()
  const videoBases = new Map()
  for (const file of files) {
    if (file.kind !== 'video' || motion.has(file.path)) continue
    const bases = videoBases.get(file.dir)
    if (bases) bases.add(file.base)
    else videoBases.set(file.dir, new Set([file.base]))
    for (let dir = file.dir; dir && !videoDirs.has(dir); dir = parentOf(dir)) videoDirs.add(dir)
  }

  const sidecars = new Set()
  for (const [dir, group] of dirs) {
    let index = null
    for (const file of group) {
      let sidecar = PHOTO_SIDECARS.has(file.extension)
      if (!sidecar && file.extension === 'json') {
        index = index || takeoutIndex(group.filter((other) => isImageKind(other.kind) || other.kind === 'video').map((other) => other.lower))
        // Takeout's album details sit beside the album's photos.
        sidecar = index.names.size > 0 && (file.lower === 'metadata.json' || takeoutTarget(file.lower, index) !== null)
      }
      if (!sidecar && videoDirs.has(dir)) {
        sidecar = file.kind === 'subtitle' || VIDEO_SIDECARS.has(file.extension) ||
          ((file.kind === 'image' || file.extension === 'tbn') && !pairs.has(file.path) && isArtworkName(file.base, videoBases.get(dir)))
      }
      if (!sidecar && file.kind === 'subtitle') sidecar = inSubsFolder(dir, videoDirs)
      if (sidecar) sidecars.add(file.path)
    }
  }

  return { folder, files, junk, hasSite, pairs, motion, sidecars }
}

/** Live Photos: a Map from each image's path to its motion part's path. */
export function livePhotoPairs (entries, folderPath = '/') {
  return analyze(entries, folderPath).pairs
}

/** The paths of photo and video sidecars, which are not counted or shown as items. */
export function sidecarsOf (entries, folderPath = '/') {
  return analyze(entries, folderPath).sidecars
}

/**
 * Which view a folder opens in, from its files (recursive) as
 * { path, size, mtime }. Returns { view, counts, hasSite, others }: view is
 * 'files', 'photos' or 'videos'; counts.audio plus counts.other are the files
 * that are neither photos nor videos, and others lists their paths.
 */
export function classify (entries, folderPath = '/') {
  const { files, junk, hasSite, motion, sidecars } = analyze(entries, folderPath)
  const counts = { image: 0, video: 0, audio: 0, other: 0, junk, sidecar: 0, live: 0 }
  const others = []
  for (const file of files) {
    if (motion.has(file.path)) counts.live++
    else if (sidecars.has(file.path)) counts.sidecar++
    else if (isImageKind(file.kind)) counts.image++
    else if (file.kind === 'video') counts.video++
    else {
      if (file.kind === 'audio') counts.audio++
      else counts.other++
      others.push(file.path)
    }
  }
  others.sort(naturalCompare)
  const media = counts.image + counts.video
  const rest = counts.audio + counts.other
  let view
  if (media === 0 || rest > Math.max(2, Math.ceil(0.02 * media))) view = 'files'
  else if (counts.video === 0) view = 'photos'
  else if (counts.image === 0) view = 'videos'
  else view = counts.video > 3 * counts.image ? 'videos' : 'photos'
  return { view, counts, hasSite, others }
}
