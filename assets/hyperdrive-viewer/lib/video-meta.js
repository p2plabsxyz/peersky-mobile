// A video's details from its container: length, size, codecs, title and
// show details, when and where it was made, and where its cover image sits.
// Pure: no DOM, no network; read(start, endInclusive) does the I/O. Every
// file is untrusted: each loop has a count and each read a cap.
import { boxesIn, createByteSource } from './exif.js'
import { extensionOf, KINDS } from './kinds.js'

const FIRST_READ = 128 * 1024
const MAX_MOOV = 16 * 1024 * 1024
const MAX_READS = 8
const MAX_TOTAL = MAX_MOOV + 2 * 1024 * 1024
const MAX_ELEMENT = 1024 * 1024
const MAX_TEXT = 4096
// Seconds from 1904 (QuickTime) and nanoseconds from 2001 (Matroska).
const QUICKTIME_EPOCH = Date.UTC(1904, 0, 1)
const MATROSKA_EPOCH = Date.UTC(2001, 0, 1)

const be16 = (b, i) => (b[i] << 8) | b[i + 1]
const be32 = (b, i) => b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])
const be64 = (b, i) => be32(b, i) * 0x100000000 + be32(b, i + 4)
const s32 = (b, i) => be32(b, i) | 0
const fourcc = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])
const utf8 = new TextDecoder('utf-8')
const utf16 = new TextDecoder('utf-16be')

function emptyMeta () {
  return {
    container: null,
    duration: null,
    width: null,
    height: null,
    rotation: null,
    videoCodec: null,
    audioCodec: null,
    title: null,
    year: null,
    description: null,
    genre: null,
    show: null,
    season: null,
    episode: null,
    created: null,
    offset: null,
    gps: null,
    cover: null,
    faststart: null
  }
}

function cleanText (text, max = MAX_TEXT) {
  if (typeof text !== 'string') return null
  // Up to a zero byte, without control characters other than line breaks.
  const clean = text.split('\0')[0].replace(/[^\P{Cc}\t\n\r]/gu, '').trim().slice(0, max)
  return clean || null
}

function yearOf (text) {
  const match = /(?:^|\D)(\d{4})(?!\d)/.exec(String(text ?? ''))
  const year = match ? Number(match[1]) : NaN
  return year >= 1870 && year <= new Date().getUTCFullYear() + 1 ? year : null
}

function countOf (value, max = 99999) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null
}

function place (lat, lon, alt) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null
  return { lat, lon, alt: Number.isFinite(alt) && Math.abs(alt) < 100000 ? alt : null }
}

// One ISO 6709 part: degrees, or degrees and minutes, or degrees, minutes
// and seconds, by how many digits come before the point.
function sexagesimal (sign, whole, fraction, degreeDigits) {
  let value
  if (whole.length <= degreeDigits) value = Number(whole + fraction)
  else if (whole.length === degreeDigits + 2) value = Number(whole.slice(0, degreeDigits)) + Number(whole.slice(degreeDigits) + fraction) / 60
  else if (whole.length === degreeDigits + 4) {
    value = Number(whole.slice(0, degreeDigits)) + Number(whole.slice(degreeDigits, degreeDigits + 2)) / 60 + Number(whole.slice(degreeDigits + 2) + fraction) / 3600
  } else return NaN
  return sign === '-' ? -value : value
}

// "+35.6919+139.6921+057.000/" as { lat, lon, alt }.
export function parseIso6709 (text) {
  const match = /^\s*([+-])(\d{1,7})(\.\d{1,12})?([+-])(\d{1,8})(\.\d{1,12})?([+-]\d{1,7}(?:\.\d{1,12})?)?/.exec(String(text ?? ''))
  if (!match) return null
  const lat = sexagesimal(match[1], match[2], match[3] || '', 2)
  const lon = sexagesimal(match[4], match[5], match[6] || '', 3)
  return place(lat, lon, match[7] ? Number(match[7]) : NaN)
}

// "2025-11-03T16:20:00+0900": the instant and the offset in minutes. A time
// without a zone says nothing certain, so it is left out.
function isoDate (text) {
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})/.exec(String(text ?? ''))
  if (!match) return null
  const [, y, mo, d, h, mi, s = '0', zone] = match
  const time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (!Number.isFinite(time) || new Date(time).getUTCDate() !== Number(d) || Number(mo) > 12) return null
  const offset = zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)))
  if (Math.abs(offset) > 14 * 60) return null
  return { created: time - offset * 60000, offset }
}

function validInstant (time) {
  if (!Number.isFinite(time)) return null
  const year = new Date(time).getUTCFullYear()
  return year >= 1971 && year <= new Date().getUTCFullYear() + 1 ? time : null
}

// QuickTime user data text: [size][language][text], or plain text.
function quickTimeText (bytes, box) {
  const p = box.payload
  if (box.end - p >= 4) {
    const size = be16(bytes, p)
    if (size > 0 && p + 4 + size <= box.end) return cleanText(utf8.decode(bytes.subarray(p + 4, p + 4 + size)))
  }
  return cleanText(utf8.decode(bytes.subarray(p, box.end)))
}

// A 3GPP string after version, flags and language: UTF-8, or UTF-16 after a
// byte order mark; it ends at a zero.
function gppString (bytes, at, end) {
  if (at + 2 <= end && bytes[at] === 0xfe && bytes[at + 1] === 0xff) {
    let stop = at + 2
    while (stop + 1 < end && (bytes[stop] || bytes[stop + 1])) stop += 2
    return { text: cleanText(utf16.decode(bytes.subarray(at + 2, stop))), next: Math.min(end, stop + 2) }
  }
  let stop = at
  while (stop < end && bytes[stop]) stop++
  return { text: cleanText(utf8.decode(bytes.subarray(at, stop))), next: Math.min(end, stop + 1) }
}

// 3GPP loci: version and flags, language, name, role, then longitude,
// latitude and altitude as signed 16.16 fixed point.
function readLoci (bytes, box) {
  const { next } = gppString(bytes, box.payload + 6, box.end)
  const at = next + 1
  if (at + 12 > box.end) return null
  return place(s32(bytes, at + 4) / 65536, s32(bytes, at) / 65536, s32(bytes, at + 8) / 65536)
}

function dataValue (bytes, type, start, end) {
  if (type === 1) return cleanText(utf8.decode(bytes.subarray(start, end)))
  if (type === 2) return cleanText(utf16.decode(bytes.subarray(start, end)))
  if ((type === 21 || type === 22 || type === 0) && end - start >= 1 && end - start <= 8) {
    let value = 0
    for (let i = start; i < end; i++) value = value * 256 + bytes[i]
    if (type === 21 && bytes[start] & 0x80) value -= 2 ** (8 * (end - start))
    return value
  }
  return null
}

const IMAGE_TYPES = { 13: 'image/jpeg', 14: 'image/png', 27: 'image/bmp' }

// iTunes items (udta/meta/ilst) and QuickTime mdta keys (moov/meta) into
// found, which keeps the first value for each field.
function readMetaBox (bytes, box, base, found) {
  // ISO meta has version and flags; QuickTime's has none.
  let start = box.payload
  if (!['hdlr', 'keys', 'ilst', 'mhdr', 'free'].includes(fourcc(bytes, start + 4))) start += 4
  const children = boxesIn(bytes, start, box.end, 64)
  const handler = children.find((child) => child.type === 'hdlr')
  const byKey = handler && handler.end - handler.payload >= 12 && fourcc(bytes, handler.payload + 8) === 'mdta'
  const keys = []
  const keysBox = children.find((child) => child.type === 'keys')
  if (keysBox && keysBox.end - keysBox.payload >= 8) {
    const count = be32(bytes, keysBox.payload + 4)
    let q = keysBox.payload + 8
    for (let i = 0; i < count && i < 1000 && q + 8 <= keysBox.end; i++) {
      const size = be32(bytes, q)
      if (size < 8 || q + size > keysBox.end) break
      keys.push(utf8.decode(bytes.subarray(q + 8, q + size)))
      q += size
    }
  }
  const list = children.find((child) => child.type === 'ilst')
  if (!list) return
  for (const item of boxesIn(bytes, list.payload, list.end, 1000)) {
    const name = byKey ? keys[be32(bytes, item.start + 4) - 1] : item.type
    if (!name) continue
    const data = boxesIn(bytes, item.payload, item.end, 8).find((child) => child.type === 'data' && child.end - child.payload >= 8)
    if (!data) continue
    const type = be32(bytes, data.payload) & 0xffffff
    const from = data.payload + 8
    const value = dataValue(bytes, type, from, data.end)
    const text = typeof value === 'string' ? value : null
    switch (name) {
      case '©nam': case 'com.apple.quicktime.title': set(found, 'title', text); break
      case '©day': set(found, 'year', yearOf(value)); break
      case 'ldes': set(found, 'longDescription', text); break
      case 'desc': case 'com.apple.quicktime.description': set(found, 'description', text); break
      case '©gen': case 'com.apple.quicktime.genre': set(found, 'genre', text); break
      case 'tvsh': set(found, 'show', text); break
      case 'tvsn': set(found, 'season', countOf(value)); break
      case 'tves': set(found, 'episode', countOf(value)); break
      case 'com.apple.quicktime.location.ISO6709': set(found, 'gps', parseIso6709(text)); break
      case 'com.apple.quicktime.creationdate': set(found, 'date', isoDate(text)); break
      case 'covr': {
        const sniffed = bytes[from] === 0xff && bytes[from + 1] === 0xd8 ? 'image/jpeg' : bytes[from] === 0x89 && bytes[from + 1] === 0x50 ? 'image/png' : null
        const mime = IMAGE_TYPES[type] || sniffed
        if (mime && data.end > from) set(found, 'cover', { offset: base + from, length: data.end - from, type: mime })
        break
      }
    }
  }
}

function set (found, key, value) {
  if (value !== null && value !== undefined && found[key] === undefined) found[key] = value
}

function readUdta (bytes, udta, base, sources) {
  for (const box of boxesIn(bytes, udta.payload, udta.end, 256)) {
    if (box.type === 'meta') readMetaBox(bytes, box, base, sources.items)
    else if (box.type === '©xyz') set(sources.quickTime, 'gps', parseIso6709(quickTimeText(bytes, box)))
    else if (box.type === 'loci') set(sources.gpp, 'gps', readLoci(bytes, box))
    else if (box.type === '©nam') set(sources.quickTime, 'title', quickTimeText(bytes, box))
    else if (box.type === '©day') set(sources.quickTime, 'year', yearOf(quickTimeText(bytes, box)))
    else if (box.type === '©des' || box.type === '©inf') set(sources.quickTime, 'description', quickTimeText(bytes, box))
    else if (box.type === 'titl') set(sources.gpp, 'title', gppString(bytes, box.payload + 6, box.end).text)
    else if (box.type === 'dscp') set(sources.gpp, 'description', gppString(bytes, box.payload + 6, box.end).text)
    else if (box.type === 'yrrc' && box.end - box.payload >= 6) set(sources.gpp, 'year', yearOf(String(be16(bytes, box.payload + 4))))
  }
}

function rotationOf (a, b, c, d) {
  const key = [a, b, c, d].map(Math.round).join(',')
  return { '1,0,0,1': 0, '0,1,-1,0': 90, '-1,0,0,-1': 180, '0,-1,1,0': 270 }[key] ?? 0
}

function readTrak (bytes, trak) {
  const track = { handler: null, width: 0, height: 0, rotation: 0, codec: null }
  for (const box of boxesIn(bytes, trak.payload, trak.end, 64)) {
    if (box.type === 'tkhd') {
      const p = box.payload
      const matrix = p + (bytes[p] === 1 ? 52 : 40)
      if (matrix + 44 <= box.end) {
        track.rotation = rotationOf(s32(bytes, matrix) / 65536, s32(bytes, matrix + 4) / 65536, s32(bytes, matrix + 12) / 65536, s32(bytes, matrix + 16) / 65536)
        track.width = Math.round(be32(bytes, matrix + 36) / 65536)
        track.height = Math.round(be32(bytes, matrix + 40) / 65536)
      }
    } else if (box.type === 'mdia') {
      for (const inner of boxesIn(bytes, box.payload, box.end, 64)) {
        if (inner.type === 'hdlr' && inner.end - inner.payload >= 12) track.handler = fourcc(bytes, inner.payload + 8)
        if (inner.type !== 'minf') continue
        const stbl = boxesIn(bytes, inner.payload, inner.end, 64).find((child) => child.type === 'stbl')
        const stsd = stbl && boxesIn(bytes, stbl.payload, stbl.end, 64).find((child) => child.type === 'stsd')
        const [entry] = stsd ? boxesIn(bytes, stsd.payload + 8, stsd.end, 1) : []
        if (!entry) continue
        const codec = entry.type.split('\0')[0].trim().toLowerCase()
        track.codec = codec === '.mp3' ? 'mp3' : codec || null
        // A visual sample entry holds the coded size too.
        if (entry.end - entry.payload >= 28) {
          track.codedWidth = be16(bytes, entry.payload + 24)
          track.codedHeight = be16(bytes, entry.payload + 26)
        }
      }
    }
  }
  return track
}

function readMoov (bytes, base, header, meta) {
  const sources = { items: {}, quickTime: {}, gpp: {} }
  let timescale = 0
  let duration = 0
  let fragments = 0
  let created = null
  let video = null
  let audio = null
  for (const box of boxesIn(bytes, header, bytes.length, 1024)) {
    const p = box.payload
    if (box.type === 'mvhd') {
      const long = bytes[p] === 1
      if (box.end - p < (long ? 32 : 20)) continue
      created = long ? be64(bytes, p + 4) : be32(bytes, p + 4)
      timescale = be32(bytes, p + (long ? 20 : 12))
      duration = long ? be64(bytes, p + 24) : be32(bytes, p + 16)
      // All ones means the length is unknown.
      if (duration === 0xffffffff || duration >= 2 ** 53) duration = 0
    } else if (box.type === 'trak') {
      const track = readTrak(bytes, box)
      if (track.handler === 'vide' && !video) video = track
      else if (track.handler === 'soun' && !audio) audio = track
    } else if (box.type === 'udta') {
      readUdta(bytes, box, base, sources)
    } else if (box.type === 'meta') {
      readMetaBox(bytes, box, base, sources.items)
    } else if (box.type === 'mvex') {
      const mehd = boxesIn(bytes, p, box.end, 64).find((child) => child.type === 'mehd')
      if (mehd && mehd.end - mehd.payload >= 8) fragments = bytes[mehd.payload] === 1 && mehd.end - mehd.payload >= 12 ? be64(bytes, mehd.payload + 4) : be32(bytes, mehd.payload + 4)
    }
  }
  if (timescale > 0 && (duration || fragments)) meta.duration = (duration || fragments) / timescale
  if (video) {
    const width = video.width || video.codedWidth || 0
    const height = video.height || video.codedHeight || 0
    const turned = video.rotation === 90 || video.rotation === 270
    meta.width = (turned ? height : width) || null
    meta.height = (turned ? width : height) || null
    meta.rotation = video.rotation
    meta.videoCodec = video.codec
  }
  if (audio) meta.audioCodec = audio.codec
  // iTunes items first, then QuickTime keys and text, then 3GPP atoms.
  const pick = (key) => [sources.items, sources.quickTime, sources.gpp].map((source) => source[key]).find((value) => value !== undefined) ?? null
  meta.title = pick('title')
  meta.year = pick('year')
  meta.description = sources.items.longDescription ?? pick('description')
  meta.genre = pick('genre')
  meta.show = pick('show')
  meta.season = pick('season')
  meta.episode = pick('episode')
  meta.gps = pick('gps')
  meta.cover = pick('cover')
  const date = pick('date')
  if (date) {
    meta.created = date.created
    meta.offset = date.offset
  } else if (created) {
    meta.created = validInstant(QUICKTIME_EPOCH + created * 1000)
  }
}

async function readBmff (src, meta, first) {
  const brand = fourcc(first, 4) === 'ftyp' && first.length >= 12 ? fourcc(first, 8) : null
  meta.container = !brand || brand === 'qt  ' ? 'mov' : brand.startsWith('M4V') ? 'm4v' : brand.startsWith('3g') ? '3gp' : 'mp4'
  // Top-level box headers, skipping mdat by its size.
  let pos = 0
  let moov = null
  let media = false
  for (let count = 0; count < 64 && pos + 8 <= src.size; count++) {
    const head = src.peek(pos, 16) || (await src.need(pos, 16)) || (await src.need(pos, 8))
    if (!head) break
    let size = be32(head, 0)
    let header = 8
    if (size === 1) {
      if (head.length < 16) break
      size = be64(head, 8)
      header = 16
    } else if (size === 0) {
      size = src.size - pos
    }
    const type = fourcc(head, 4)
    if (!(size >= header) || !Number.isFinite(size)) break
    if (type === 'moov') {
      moov = { start: pos, header, size }
      break
    }
    if (type === 'mdat') media = true
    pos += size
  }
  if (!moov) return
  meta.faststart = !media
  const length = Math.min(moov.size, MAX_MOOV)
  const bytes = src.peek(moov.start, length) || (await src.need(moov.start, length)) || src.peekUpTo(moov.start, length)
  if (bytes && bytes.length > moov.header) readMoov(bytes, moov.start, moov.header, meta)
}

// Matroska element IDs.
const ID = {
  EBML: 0x1a45dfa3,
  DOC_TYPE: 0x4282,
  SEGMENT: 0x18538067,
  SEEK_HEAD: 0x114d9b74,
  SEEK: 0x4dbb,
  SEEK_ID: 0x53ab,
  SEEK_POSITION: 0x53ac,
  INFO: 0x1549a966,
  TIMESTAMP_SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  TITLE: 0x7ba9,
  DATE_UTC: 0x4461,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_TYPE: 0x83,
  CODEC_ID: 0x86,
  VIDEO: 0xe0,
  PIXEL_WIDTH: 0xb0,
  PIXEL_HEIGHT: 0xba,
  DISPLAY_WIDTH: 0x54b0,
  DISPLAY_HEIGHT: 0x54ba,
  DISPLAY_UNIT: 0x54b2,
  TAGS: 0x1254c367,
  TAG: 0x7373,
  TARGETS: 0x63c0,
  TARGET_TYPE_VALUE: 0x68ca,
  TAG_TRACK_UID: 0x63c5,
  TAG_EDITION_UID: 0x63c9,
  TAG_CHAPTER_UID: 0x63c4,
  TAG_ATTACHMENT_UID: 0x63c6,
  SIMPLE_TAG: 0x67c8,
  TAG_NAME: 0x45a3,
  TAG_STRING: 0x4487,
  ATTACHMENTS: 0x1941a469,
  ATTACHED_FILE: 0x61a7,
  FILE_NAME: 0x466e,
  FILE_MIME_TYPE: 0x4660,
  FILE_DATA: 0x465c,
  CLUSTER: 0x1f43b675
}

const MATROSKA_CODECS = {
  'V_MPEG4/ISO/AVC': 'avc1',
  'V_MPEGH/ISO/HEVC': 'hvc1',
  V_AV1: 'av01',
  V_VP9: 'vp09',
  V_VP8: 'vp8',
  'V_MPEG4/ISO/ASP': 'mp4v',
  'V_MPEG4/ISO/SP': 'mp4v',
  V_MPEG2: 'mp2v',
  V_THEORA: 'theora',
  A_AAC: 'mp4a',
  A_OPUS: 'opus',
  A_VORBIS: 'vorbis',
  A_AC3: 'ac-3',
  A_EAC3: 'ec-3',
  A_FLAC: 'flac',
  A_DTS: 'dts',
  'A_MPEG/L3': 'mp3',
  'A_MPEG/L2': 'mp2',
  A_TRUEHD: 'truehd',
  'A_PCM/INT/LIT': 'lpcm',
  'A_PCM/INT/BIG': 'lpcm',
  'A_PCM/FLOAT/IEEE': 'lpcm'
}

function codecName (id) {
  if (!id) return null
  if (MATROSKA_CODECS[id]) return MATROSKA_CODECS[id]
  if (id.startsWith('A_AAC')) return 'mp4a'
  return id.toLowerCase().slice(0, 32)
}

// An EBML element header at pos: its ID, data start and size (null when
// unknown), or null when the bytes do not make one.
function elementAt (bytes, pos, to = bytes.length) {
  const first = bytes[pos]
  if (first === undefined || pos >= to) return null
  const idLength = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0
  if (!idLength || pos + idLength >= to) return null
  let id = 0
  for (let i = 0; i < idLength; i++) id = id * 256 + bytes[pos + i]
  const lead = bytes[pos + idLength]
  let sizeLength = 0
  while (sizeLength < 8 && !(lead & (0x80 >> sizeLength))) sizeLength++
  sizeLength++
  if (sizeLength > 8 || pos + idLength + sizeLength > to) return null
  const mask = 0xff >> sizeLength
  let size = lead & mask
  let unknown = size === mask
  for (let i = 1; i < sizeLength; i++) {
    const byte = bytes[pos + idLength + i]
    size = size * 256 + byte
    if (byte !== 0xff) unknown = false
  }
  return { id, start: pos, data: pos + idLength + sizeLength, size: unknown ? null : size }
}

// Child elements of bytes[from, to). One that runs past to is cut at to.
function elementsIn (bytes, from, to, limit = 4096) {
  const found = []
  let pos = from
  while (pos < to && found.length < limit) {
    const element = elementAt(bytes, pos, to)
    if (!element) break
    const end = element.size === null ? to : Math.min(to, element.data + element.size)
    found.push({ ...element, end, cut: element.size !== null && element.data + element.size > to })
    if (element.size === null) break
    pos = element.data + element.size
  }
  return found
}

function uintOf (bytes, element) {
  const length = element.end - element.data
  if (length < 1 || length > 8 || element.cut) return null
  let value = 0
  for (let i = element.data; i < element.end; i++) value = value * 256 + bytes[i]
  return value
}

function floatOf (bytes, element) {
  const length = element.end - element.data
  if (element.cut || (length !== 4 && length !== 8)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset + element.data, length)
  return length === 4 ? view.getFloat32(0) : view.getFloat64(0)
}

function textOf (bytes, element) {
  if (element.cut) return null
  return cleanText(utf8.decode(bytes.subarray(element.data, Math.min(element.end, element.data + MAX_TEXT))))
}

function readInfo (bytes, from, to, meta, found) {
  let scale = 1000000
  let duration = null
  for (const element of elementsIn(bytes, from, to, 256)) {
    if (element.id === ID.TIMESTAMP_SCALE) scale = uintOf(bytes, element) || scale
    else if (element.id === ID.DURATION) duration = floatOf(bytes, element)
    else if (element.id === ID.TITLE) set(found, 'infoTitle', textOf(bytes, element))
    else if (element.id === ID.DATE_UTC && element.end - element.data === 8 && !element.cut) {
      const nanoseconds = s32(bytes, element.data) * 0x100000000 + be32(bytes, element.data + 4)
      meta.created = validInstant(MATROSKA_EPOCH + nanoseconds / 1e6)
    }
  }
  if (Number.isFinite(duration) && duration > 0) meta.duration = (duration * scale) / 1e9
}

function readTracks (bytes, from, to, meta) {
  for (const entry of elementsIn(bytes, from, to, 256)) {
    if (entry.id !== ID.TRACK_ENTRY) continue
    let type = null
    let codec = null
    let video = null
    for (const element of elementsIn(bytes, entry.data, entry.end, 256)) {
      if (element.id === ID.TRACK_TYPE) type = uintOf(bytes, element)
      else if (element.id === ID.CODEC_ID) codec = textOf(bytes, element)
      else if (element.id === ID.VIDEO) {
        video = {}
        for (const inner of elementsIn(bytes, element.data, element.end, 64)) {
          if (inner.id === ID.PIXEL_WIDTH) video.width = uintOf(bytes, inner)
          else if (inner.id === ID.PIXEL_HEIGHT) video.height = uintOf(bytes, inner)
          else if (inner.id === ID.DISPLAY_WIDTH) video.displayWidth = uintOf(bytes, inner)
          else if (inner.id === ID.DISPLAY_HEIGHT) video.displayHeight = uintOf(bytes, inner)
          else if (inner.id === ID.DISPLAY_UNIT) video.unit = uintOf(bytes, inner)
        }
      }
    }
    if (type === 1 && meta.videoCodec === null) {
      meta.videoCodec = codecName(codec)
      if (video) {
        // Display size when given in pixels, so a squeezed picture shows wide.
        const display = !video.unit && video.displayWidth > 0 && video.displayHeight > 0
        meta.width = (display ? video.displayWidth : video.width) || null
        meta.height = (display ? video.displayHeight : video.height) || null
      }
      meta.rotation = 0
    } else if (type === 2 && meta.audioCodec === null) {
      meta.audioCodec = codecName(codec)
    }
  }
}

// Tags apply to the whole file unless they name a track, edition, chapter or
// attachment. For TV, level 70 is the show, 60 the season, 50 the episode.
function readTags (bytes, from, to, found) {
  const levels = new Map()
  for (const tag of elementsIn(bytes, from, to, 1024)) {
    if (tag.id !== ID.TAG) continue
    let level = 50
    let specific = false
    const values = {}
    for (const element of elementsIn(bytes, tag.data, tag.end, 256)) {
      if (element.id === ID.TARGETS) {
        for (const target of elementsIn(bytes, element.data, element.end, 64)) {
          if (target.id === ID.TARGET_TYPE_VALUE) level = uintOf(bytes, target) ?? level
          else if ([ID.TAG_TRACK_UID, ID.TAG_EDITION_UID, ID.TAG_CHAPTER_UID, ID.TAG_ATTACHMENT_UID].includes(target.id) && uintOf(bytes, target)) specific = true
        }
      } else if (element.id === ID.SIMPLE_TAG) {
        let name = null
        let value = null
        for (const inner of elementsIn(bytes, element.data, element.end, 64)) {
          if (inner.id === ID.TAG_NAME) name = textOf(bytes, inner)
          else if (inner.id === ID.TAG_STRING) value = textOf(bytes, inner)
        }
        if (name && value) set(values, name.toUpperCase(), value)
      }
    }
    if (!specific) levels.set(level, { ...values, ...levels.get(level) })
  }
  const movie = levels.get(50) || {}
  const season = levels.get(60)
  const show = levels.get(70)
  set(found, 'title', movie.TITLE)
  set(found, 'year', yearOf(movie.DATE_RELEASED ?? show?.DATE_RELEASED))
  set(found, 'description', movie.DESCRIPTION ?? movie.SUMMARY ?? movie.SYNOPSIS ?? movie.COMMENT)
  set(found, 'genre', movie.GENRE ?? show?.GENRE)
  if (season) {
    set(found, 'show', show?.TITLE)
    set(found, 'season', countOf(Number(season.PART_NUMBER)))
    set(found, 'episode', countOf(Number(movie.PART_NUMBER)))
  }
}

// An element's header from the file, reading only when it is not in hand.
async function headerAt (src, pos) {
  const want = Math.min(12, src.size - pos)
  if (!(want >= 2)) return null
  const bytes = src.peek(pos, want) || (await src.need(pos, want)) || src.peekUpTo(pos, want)
  if (!bytes) return null
  const element = elementAt(bytes, 0, bytes.length)
  return element && { id: element.id, size: element.size, data: pos + element.data }
}

// Attachments: the first image whose name starts with "cover", found from
// element headers so the files themselves are never read.
async function readAttachments (src, start, end, meta) {
  let pos = start
  for (let files = 0; files < 32 && pos < end; files++) {
    const file = await headerAt(src, pos)
    if (!file || file.size === null) return
    if (file.id === ID.ATTACHED_FILE) {
      let name = null
      let mime = null
      let data = null
      let inner = file.data
      for (let count = 0; count < 16 && inner < file.data + file.size; count++) {
        const element = await headerAt(src, inner)
        if (!element || element.size === null) break
        if (element.id === ID.FILE_DATA) data = { offset: element.data, length: element.size }
        else if ((element.id === ID.FILE_NAME || element.id === ID.FILE_MIME_TYPE) && element.size <= MAX_TEXT) {
          const bytes = await src.need(element.data, element.size)
          const text = bytes ? cleanText(utf8.decode(bytes)) : null
          if (element.id === ID.FILE_NAME) name = text
          else mime = text
        }
        inner = element.data + element.size
        // Enough to judge; what follows the file's data is never read.
        if (name && mime && data) break
      }
      if (name && /^cover/i.test(name) && /^image\/(jpeg|png|webp|gif)$/i.test(mime || '') && data && data.length > 0 && data.offset + data.length <= src.size) {
        meta.cover = { offset: data.offset, length: data.length, type: mime.toLowerCase() }
        return
      }
    }
    pos = file.data + file.size
  }
}

async function readMatroska (src, meta, first) {
  const ebml = elementAt(first, 0)
  if (!ebml || ebml.id !== ID.EBML || ebml.size === null) return
  meta.container = 'mkv'
  for (const element of elementsIn(first, ebml.data, Math.min(first.length, ebml.data + ebml.size), 32)) {
    if (element.id === ID.DOC_TYPE && textOf(first, element) === 'webm') meta.container = 'webm'
  }
  let segment = null
  let pos = ebml.data + ebml.size
  for (let count = 0; count < 8 && !segment; count++) {
    const element = await headerAt(src, pos)
    if (!element) return
    if (element.id === ID.SEGMENT) segment = element
    else if (element.size === null) return
    else pos = element.data + element.size
  }
  if (!segment) return
  const segmentStart = segment.data
  const segmentEnd = segment.size === null ? src.size : segmentStart + segment.size
  // What the first read holds, then what the SeekHeads point to.
  const places = new Map()
  const seekHeads = []
  pos = segmentStart
  for (let count = 0; count < 64 && pos < segmentEnd; count++) {
    const bytes = src.peekUpTo(pos, 12)
    const element = bytes && elementAt(bytes, 0, bytes.length)
    if (!element || element.id === ID.CLUSTER) break
    if (element.id === ID.SEEK_HEAD) seekHeads.push(pos)
    else if (!places.has(element.id)) places.set(element.id, pos)
    if (element.size === null) break
    pos += element.data + element.size
  }
  for (let i = 0; i < seekHeads.length && i < 3; i++) {
    const head = await headerAt(src, seekHeads[i])
    if (!head || head.id !== ID.SEEK_HEAD || head.size === null || head.size > 64 * 1024) continue
    const bytes = await src.need(head.data, head.size)
    if (!bytes) continue
    for (const seek of elementsIn(bytes, 0, bytes.length, 256)) {
      if (seek.id !== ID.SEEK) continue
      let id = null
      let offset = null
      for (const element of elementsIn(bytes, seek.data, seek.end, 8)) {
        if (element.id === ID.SEEK_ID) id = uintOf(bytes, element)
        else if (element.id === ID.SEEK_POSITION) offset = uintOf(bytes, element)
      }
      if (id === null || offset === null || segmentStart + offset >= segmentEnd) continue
      if (id === ID.SEEK_HEAD && !seekHeads.includes(segmentStart + offset)) seekHeads.push(segmentStart + offset)
      else if (!places.has(id)) places.set(id, segmentStart + offset)
    }
  }
  const found = {}
  const load = async (id, max) => {
    const at = places.get(id)
    const head = at === undefined ? null : await headerAt(src, at)
    if (!head || head.id !== id || head.size === null) return null
    const length = Math.min(head.size, max)
    return src.peek(head.data, length) || (await src.need(head.data, length)) || src.peekUpTo(head.data, length)
  }
  const info = await load(ID.INFO, 64 * 1024)
  if (info) readInfo(info, 0, info.length, meta, found)
  const tracks = await load(ID.TRACKS, MAX_ELEMENT)
  if (tracks) readTracks(tracks, 0, tracks.length, meta)
  const tags = await load(ID.TAGS, MAX_ELEMENT)
  if (tags) readTags(tags, 0, tags.length, found)
  const attachments = places.get(ID.ATTACHMENTS)
  if (attachments !== undefined) {
    const head = await headerAt(src, attachments)
    if (head && head.id === ID.ATTACHMENTS && head.size !== null) await readAttachments(src, head.data, head.data + head.size, meta)
  }
  meta.title = found.title ?? found.infoTitle ?? null
  meta.year = found.year ?? null
  meta.description = found.description ?? null
  meta.genre = found.genre ?? null
  meta.show = found.show ?? null
  meta.season = found.season ?? null
  meta.episode = found.episode ?? null
}

const VIDEO_EXTENSIONS = new Set(KINDS.video)

// Containers the viewer only names.
function otherContainer (b, name) {
  const at = (i, text) => b.length >= i + text.length && String.fromCharCode(...b.subarray(i, i + text.length)) === text
  if (at(0, 'RIFF') && at(8, 'AVI ')) return 'avi'
  if (b.length >= 16 && be32(b, 0) === 0x3026b275 && be32(b, 4) === 0x8e66cf11) return 'wmv'
  if (at(0, 'FLV') && b[3] === 1) return 'flv'
  if (at(0, 'OggS')) return 'ogg'
  if (b.length > 376 && b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47) return 'ts'
  if (b.length > 388 && b[4] === 0x47 && b[196] === 0x47 && b[388] === 0x47) return 'ts'
  if (b.length >= 4 && be32(b, 0) === 0x000001ba) return 'mpg'
  if (b.length >= 4 && be32(b, 0) === 0x000001b3) return 'mpg'
  const extension = extensionOf(name || '')
  return VIDEO_EXTENSIONS.has(extension) ? extension : null
}

/**
 * Details of a video, from read(start, endInclusive) => Promise<ArrayBuffer>
 * and the file's size. Resolves to { container, duration (seconds), width,
 * height (as shown, after rotation), rotation (degrees clockwise), videoCodec,
 * audioCodec, title, year, description, genre, show, season, episode,
 * created, offset, gps, cover, faststart }, any of them null. created is a
 * real instant (ms since 1970 UTC); offset is minutes east of UTC when the
 * file says (QuickTime creationdate), for wall-clock time. cover is
 * { offset, length, type } of an embedded image for the caller to read.
 * MP4 and MOV: box headers with small reads, then moov whole (up to 16 MB).
 * Matroska and WebM: SeekHead, Info, Tracks, Tags and Attachments only.
 * Others: the container only. Rejects only when read() does.
 */
export async function readVideoMeta (read, options) {
  const size = options && options.size
  const name = options && options.name
  const meta = emptyMeta()
  const src = createByteSource(read, size, { maxReads: MAX_READS, maxTotal: MAX_TOTAL })
  try {
    const first = await src.load(0, FIRST_READ)
    if (!first || first.length < 12) {
      meta.container = otherContainer(new Uint8Array(0), name)
      return meta
    }
    const type = fourcc(first, 4)
    if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(type)) await readBmff(src, meta, first)
    else if (be32(first, 0) === ID.EBML) await readMatroska(src, meta, first)
    else meta.container = otherContainer(first, name)
  } catch (error) {
    if (src.failed) throw src.failed
  }
  return meta
}
