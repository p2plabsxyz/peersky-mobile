// Details other apps leave beside photos and videos: Google Takeout JSON,
// Kodi .nfo files and artwork. Pure: no DOM, no network.
import { baseName, extensionOf, fileName, folderIndex, folderOf, isImageKind, kindOf, takeoutIndex, takeoutTarget } from './kinds.js'
import { parseVideoName } from './names.js'

const MAX_TEXT = 1024 * 1024
const MAX_FIELD = 20000

function cleanText (value, max = MAX_FIELD) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\r\n?/g, '\n').trim().slice(0, max)
  return text || null
}

// Takeout writes 0,0 when it has no location.
function location (geo) {
  if (!geo || typeof geo !== 'object') return null
  const lat = Number(geo.latitude)
  const lon = Number(geo.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null
  const alt = Number(geo.altitude)
  return { lat, lon, alt: Number.isFinite(alt) && geo.altitude !== null && geo.altitude !== '' ? alt : null }
}

/**
 * A Google Takeout JSON: { taken, gps, title, description }, or null. taken
 * is a real instant (ms since 1970 UTC), not a wall-clock time; see
 * wallClockOf().
 */
export function parseTakeoutJson (text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null
  let data
  try {
    data = JSON.parse(text.replace(/^\ufeff/, ''))
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const seconds = Number(data.photoTakenTime && data.photoTakenTime.timestamp)
  // From 1900 to 2200: anything else is not a time a photo was taken.
  const taken = Number.isFinite(seconds) && seconds > -2208988800 && seconds < 7258118400 && seconds !== 0 ? seconds * 1000 : null
  const gps = location(data.geoData) || location(data.geoDataExif)
  const title = cleanText(data.title, 1000)
  const description = cleanText(data.description)
  if (taken === null && !gps && !title && !description) return null
  return { taken, gps, title, description }
}

/**
 * The wall-clock time of a real instant, as Date.UTC() of it (see Dates in
 * the spec): with the EXIF offset in minutes when known, else this device's
 * own offset at that time.
 */
export function wallClockOf (instant, offsetMinutes) {
  if (!Number.isFinite(instant)) return null
  if (Number.isFinite(offsetMinutes)) return instant + offsetMinutes * 60000
  return instant - new Date(instant).getTimezoneOffset() * 60000
}

function sameFolder (entries, folder) {
  return folderIndex(entries).files.get(folder) || []
}

// The JSON files of one folder by the media file each describes (folder plus
// lower-case name), the best one when several do: NAME.json, then
// NAME.supplemental-metadata.json, then the shortest.
function pickJsons (folder, names, jsons, into) {
  const index = takeoutIndex(names)
  const ranks = new Map()
  for (const path of jsons) {
    const json = fileName(path).toLowerCase()
    const target = takeoutTarget(json, index)
    if (target === null) continue
    const rank = json === target + '.json' ? 0 : json === target + '.supplemental-metadata.json' ? 1 : 2 + json.length
    const key = folder + target
    if (!(ranks.get(key) <= rank)) {
      ranks.set(key, rank)
      into.set(key, path)
    }
  }
}

function mediaAndJsons (files) {
  const names = []
  const jsons = []
  for (const entry of files) {
    const kind = kindOf(entry.path, entry.size)
    if (isImageKind(kind) || kind === 'video') names.push(fileName(entry.path).toLowerCase())
    else if (extensionOf(entry.path) === 'json') jsons.push(entry.path)
  }
  return { names, jsons }
}

const takeoutCaches = new WeakMap()

// Every folder's matches, worked out once per listing and again when it
// grows, so asking for each of 20,000 photos costs one pass.
function takeoutMatches (entries) {
  const list = Array.isArray(entries) ? entries : []
  const held = takeoutCaches.get(list)
  if (held && held.length === list.length) return held
  const matches = { length: list.length, media: new Set(), json: new Map() }
  for (const [folder, files] of folderIndex(list).files) {
    const { names, jsons } = mediaAndJsons(files)
    for (const name of names) matches.media.add(folder + name)
    if (names.length && jsons.length) pickJsons(folder, names, jsons, matches.json)
  }
  if (Array.isArray(entries)) takeoutCaches.set(entries, matches)
  return matches
}

/** The Takeout JSON describing a photo or video, as its path, or null. */
export function takeoutJsonFor (mediaPath, entries, original = true) {
  const media = String(mediaPath ?? '')
  const name = fileName(media)
  const lower = name.toLowerCase()
  if (!lower) return null
  const folder = folderOf(media)
  const matches = takeoutMatches(entries)
  let best
  if (matches.media.has(folder + lower)) {
    best = matches.json.get(folder + lower) ?? null
  } else {
    // A file the listing does not hold: its folder, with it added.
    const { names, jsons } = mediaAndJsons(sameFolder(entries, folder))
    const one = new Map()
    pickJsons(folder, [lower, ...names], jsons, one)
    best = one.get(folder + lower) ?? null
  }
  // An edited copy shares its original's JSON: IMG_1-edited.jpg.
  const unedited = name.replace(/-edited(\.[^.]+)$/i, '$1')
  if (!best && original && unedited !== name) return takeoutJsonFor(folder + unedited, entries, false)
  return best
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

function decodeEntities (text) {
  // Tags inside an element are dropped, as an XML parser's text would.
  return text.replace(/<[^>]{0,500}>/g, '').replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi, (whole, name) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
    const allowed = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return allowed ? String.fromCodePoint(code) : ''
  })
}

// Element text: CDATA as written, the rest with its entities decoded.
function decodeXml (text) {
  let out = ''
  let from = 0
  while (from < text.length) {
    const start = text.indexOf('<![CDATA[', from)
    if (start === -1) return out + decodeEntities(text.slice(from))
    out += decodeEntities(text.slice(from, start))
    const end = text.indexOf(']]>', start + 9)
    if (end === -1) return out + text.slice(start + 9)
    out += text.slice(start + 9, end)
    from = end + 3
  }
  return out
}

// Lines trimmed and at most one empty line in a row, in one pass.
function tidyLines (text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n')
}

// The text of each <name> element, found with indexOf so a hostile file
// costs one pass, not one per tag.
function elements (xml, lower, name, limit = 1) {
  const found = []
  let from = 0
  for (let tries = 0; tries < 200 && found.length < limit; tries++) {
    const open = lower.indexOf('<' + name, from)
    if (open === -1) break
    from = open + 1
    const next = lower.charAt(open + name.length + 1)
    if (next !== '>' && next !== '/' && !/\s/.test(next)) continue
    const end = lower.indexOf('>', open)
    if (end === -1) break
    if (lower.charAt(end - 1) === '/') continue
    const close = lower.indexOf('</' + name + '>', end)
    if (close === -1) break
    found.push(xml.slice(end + 1, close))
    from = close
  }
  return found
}

function numberOf (text, max) {
  const match = /^\s*(\d{1,4})\s*$/.exec(text || '')
  if (!match) return null
  const value = Number(match[1])
  return value <= max ? value : null
}

/**
 * A Kodi .nfo: { title, originalTitle, plot, year, genre, show, season,
 * episode }, or null for anything else (a plain link, a release's text art).
 */
export function parseNfo (text) {
  if (typeof text !== 'string') return null
  const xml = text.slice(0, MAX_TEXT)
  const folded = xml.toLowerCase()
  // Lower case can change a string's length; then search as written.
  const lower = folded.length === xml.length ? folded : xml
  const root = /<(movie|tvshow|episodedetails|musicvideo)[\s>]/.exec(lower)
  if (!root) return null
  const kind = root[1]
  const body = xml.slice(root.index)
  const bodyLower = lower.slice(root.index)
  const field = (name, max = MAX_FIELD) => {
    const [value] = elements(body, bodyLower, name)
    return value === undefined ? null : cleanText(tidyLines(decodeXml(value.slice(0, max * 2 + 64))), max)
  }
  const title = field('title', 500)
  const thisYear = new Date().getUTCFullYear()
  const dateYear = (value) => {
    const match = /^(\d{4})-\d{2}-\d{2}/.exec(value || '')
    return match && Number(match[1]) >= 1870 && Number(match[1]) <= thisYear + 1 ? Number(match[1]) : null
  }
  const yearText = numberOf(field('year', 10), thisYear + 1)
  const year = (yearText !== null && yearText >= 1870 ? yearText : null) ?? dateYear(field('premiered', 40)) ?? dateYear(field('aired', 40))
  const genres = elements(body, bodyLower, 'genre', 3).map((value) => cleanText(decodeXml(value.slice(0, 300)), 100)).filter(Boolean)
  const result = {
    title,
    originalTitle: field('originaltitle', 500),
    plot: field('plot') || field('outline'),
    year,
    genre: genres.length ? genres.join(', ') : null,
    show: kind === 'tvshow' ? title : kind === 'episodedetails' ? field('showtitle', 500) : null,
    // A tvshow.nfo's <season> is how many seasons there are.
    season: kind === 'episodedetails' ? numberOf(field('season', 10), 9999) : null,
    episode: kind === 'episodedetails' ? numberOf(field('episode', 10), 99999) : null
  }
  return Object.values(result).some((value) => value !== null) ? result : null
}

const SEASON_FOLDER = /^(?:season|series|s)[ ._-]*\d{1,3}$|^specials$/i

function showFolderOf (folder) {
  const name = fileName(folder)
  return SEASON_FOLDER.test(name) ? folderOf(folder) : folder
}

function findByName (entries, folder, names, test) {
  const wanted = new Map(names.map((name, i) => [name.toLowerCase(), i]))
  let best = null
  let bestRank = Infinity
  for (const entry of sameFolder(entries, folder)) {
    if (!test(entry)) continue
    const rank = wanted.get(baseName(entry.path).toLowerCase())
    if (rank !== undefined && rank < bestRank) {
      best = entry.path
      bestRank = rank
    }
  }
  return best
}

/**
 * The .nfo files for a video: { path } is <base>.nfo, else movie.nfo in its
 * folder; { showPath } is tvshow.nfo in the show's folder (the folder above a
 * season folder). Either may be null.
 */
export function nfoFor (videoPath, entries) {
  const video = String(videoPath ?? '')
  const folder = folderOf(video)
  const base = baseName(video)
  const isNfo = (entry) => extensionOf(entry.path) === 'nfo'
  const path = base ? findByName(entries, folder, [base, 'movie'], isNfo) : null
  const showPath = findByName(entries, showFolderOf(folder), ['tvshow'], isNfo)
  return { path, showPath }
}

// Pictures a page can show; HEIC, TIFF and RAW are left out.
const SHOWABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'])
const isPicture = (entry) => SHOWABLE.has(extensionOf(entry.path))

/**
 * Artwork for a video, as paths or null: poster (2:3), backdrop (wide) and
 * thumb (the episode's or movie's own still). Kodi's names: <base>-poster,
 * <base>-fanart, <base>-thumb, <base>.jpg; poster, folder, cover and fanart
 * in the folder; season01-poster and the show's own in the show's folder.
 */
export function artworkFor (videoPath, entries) {
  const video = String(videoPath ?? '')
  const folder = folderOf(video)
  const base = baseName(video)
  const show = showFolderOf(folder)
  const { season } = parseVideoName(video)
  const seasonNames = []
  if (season === 0) seasonNames.push('season-specials-poster', 'season00-poster', 'season0-poster')
  else if (Number.isInteger(season)) seasonNames.push(`season${String(season).padStart(2, '0')}-poster`, `season${season}-poster`)
  const find = (where, names) => findByName(entries, where, names.filter(Boolean), isPicture)
  const poster = find(folder, [base && `${base}-poster`, 'poster', 'folder', 'cover']) ||
    (seasonNames.length ? find(show, seasonNames) : null) ||
    (show !== folder ? find(show, ['poster', 'folder', 'cover']) : null) ||
    find(show, ['season-all-poster'])
  const backdrop = find(folder, [base && `${base}-fanart`, base && `${base}-backdrop`, base && `${base}-landscape`, 'fanart', 'backdrop', 'background', 'landscape']) ||
    (show !== folder ? find(show, ['fanart', 'backdrop', 'background', 'landscape']) : null)
  const thumb = base ? find(folder, [`${base}-thumb`, base, `${base}-landscape`]) : null
  return { poster, backdrop, thumb }
}
