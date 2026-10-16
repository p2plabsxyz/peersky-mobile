// A photo's details from the first bytes of its file: size, orientation,
// when and where it was taken, the camera, and where an embedded preview
// sits. Pure: no DOM, no network; read(start, endInclusive) does the I/O.
// Every file is untrusted: each loop has a count, each read a cap, and a
// broken file gives nulls, never an error.

const FIRST_READ = 128 * 1024
const MORE_READ = 64 * 1024
const MAX_READS = 3
const MAX_TOTAL = 1024 * 1024
const MAX_IFDS = 24
const MAX_ENTRIES = 1000
const MAX_EXIF_ITEM = 256 * 1024
const MAX_META_BOX = 512 * 1024
const MAX_PREVIEW = 64 * 1024 * 1024
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4]

const be16 = (b, i) => (b[i] << 8) | b[i + 1]
const be32 = (b, i) => b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])
const be64 = (b, i) => be32(b, i) * 0x100000000 + be32(b, i + 4)
const le16 = (b, i) => b[i] | (b[i + 1] << 8)
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 0x1000000
const fourcc = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])

function emptyMeta () {
  return {
    format: null,
    width: null,
    height: null,
    orientation: null,
    taken: null,
    offset: null,
    make: null,
    model: null,
    lens: null,
    exposureTime: null,
    fNumber: null,
    iso: null,
    focalLength: null,
    focalLength35: null,
    gps: null,
    thumbnail: null
  }
}

// The tag check also takes an ArrayBuffer made in another frame or realm.
function toBytes (buffer, length) {
  if (Object.prototype.toString.call(buffer) === '[object ArrayBuffer]') return new Uint8Array(buffer, 0, Math.min(buffer.byteLength, length))
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, Math.min(buffer.byteLength, length))
  return new Uint8Array(0)
}

// The bytes read so far by their place in the file, and the caps on reading
// more: three reads and 1 MB in all.
export function createByteSource (read, size, { maxReads = MAX_READS, maxTotal = MAX_TOTAL } = {}) {
  const parts = []
  let reads = 0
  let total = 0
  const source = {
    size: Number.isFinite(size) && size >= 0 ? size : Infinity,
    failed: null,
    peek (start, length) {
      for (const part of parts) {
        if (start >= part.start && start + length <= part.start + part.bytes.length) {
          return part.bytes.subarray(start - part.start, start - part.start + length)
        }
      }
      return null
    },
    // As many bytes from start as one earlier read holds, up to length.
    peekUpTo (start, length) {
      let best = null
      for (const part of parts) {
        if (start >= part.start && start < part.start + part.bytes.length) {
          const bytes = part.bytes.subarray(start - part.start, Math.min(part.bytes.length, start - part.start + length))
          if (!best || bytes.length > best.length) best = bytes
        }
      }
      return best
    },
    async load (start, length) {
      if (!(start >= 0) || start >= source.size || reads >= maxReads) return null
      const want = Math.min(length, source.size - start, maxTotal - total)
      if (!(want > 0)) return null
      reads++
      total += want
      let buffer
      try {
        buffer = await read(start, start + want - 1)
      } catch (error) {
        source.failed = error || new Error('read failed')
        throw source.failed
      }
      const bytes = toBytes(buffer, want)
      parts.push({ start, bytes })
      return bytes
    },
    // Exactly length bytes at start, reading more when allowed, or null.
    async need (start, length) {
      if (!(length >= 0) || !(start >= 0)) return null
      const have = source.peek(start, length)
      if (have || start + length > source.size) return have
      await source.load(start, Math.max(length, MORE_READ))
      return source.peek(start, length)
    },
    get reads () { return reads },
    get total () { return total }
  }
  return source
}

const textDecoder = new TextDecoder('utf-8')

function cleanString (bytes) {
  const end = bytes.indexOf(0)
  const text = textDecoder.decode(end === -1 ? bytes : bytes.subarray(0, end))
  // Control characters out, spaces together.
  const clean = text.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  return clean || null
}

function wallClock (year, month, day, hour, minute, second) {
  const values = [year, month, day, hour, minute, second]
  if (!values.every(Number.isInteger)) return null
  if (year < 1900 || year > new Date().getUTCFullYear() + 1) return null
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 60) return null
  const time = Date.UTC(year, month - 1, day, hour, minute, Math.min(second, 59))
  return new Date(time).getUTCDate() === day ? time : null
}

// "2024:01:02 12:34:56" as Date.UTC() of that wall-clock time.
function exifTime (text) {
  const match = /^\s*(\d{4})[:\-/.](\d{1,2})[:\-/.](\d{1,2})[ T]+(\d{1,2})[:.](\d{1,2})(?:[:.](\d{1,2}))?/.exec(text || '')
  if (!match) return null
  return wallClock(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0))
}

// "+05:30" in minutes.
function offsetOf (text) {
  const match = /^\s*([+-])(\d{2}):?(\d{2})\s*$/.exec(text || '')
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  if (Number(match[3]) > 59 || minutes > 14 * 60) return null
  return match[1] === '-' ? -minutes : minutes
}

function inRange (value, max) {
  return Number.isFinite(value) && value > 0 && value <= max ? value : null
}

// Degrees, minutes and seconds, negative for S or W.
function coordinate (parts, ref, negativeRef, limit) {
  if (!parts || !parts.length || !parts.every(Number.isFinite)) return null
  if ((parts.length > 1 && Math.abs(parts[1]) >= 60) || (parts.length > 2 && Math.abs(parts[2]) >= 60)) return null
  let value = Math.abs(parts[0]) + (parts.length > 1 ? Math.abs(parts[1]) / 60 : 0) + (parts.length > 2 ? Math.abs(parts[2]) / 3600 : 0)
  if (parts[0] < 0 || (ref && ref.toUpperCase().startsWith(negativeRef))) value = -value
  return Math.abs(value) <= limit ? value : null
}

// One TIFF structure (a TIFF file, or an Exif block inside another file)
// whose header is at base and which ends before end. Offsets in it count
// from base.
async function readTiff (src, base, end) {
  const fetch = (at, length) => at >= 0 && at + length <= end ? src.need(at, length) : Promise.resolve(null)
  const head = await fetch(base, 8)
  if (!head) return null
  const little = head[0] === 0x49 && head[1] === 0x49
  if (!little && !(head[0] === 0x4d && head[1] === 0x4d)) return null
  const u16 = little ? le16 : be16
  const u32 = little ? le32 : be32
  // 42 is TIFF; Olympus and Panasonic raw files use their own numbers.
  const magic = u16(head, 2)
  if (magic !== 42 && magic !== 0x4f52 && magic !== 0x5352 && magic !== 0x55) return null
  const visited = new Set()

  async function directory (offset) {
    if (!(offset >= 8) || visited.has(offset) || visited.size >= MAX_IFDS) return null
    visited.add(offset)
    const at = base + offset
    const countBytes = await fetch(at, 2)
    if (!countBytes) return null
    const count = u16(countBytes, 0)
    if (!count || count > MAX_ENTRIES) return null
    const table = (await fetch(at + 2, count * 12 + 4)) || (await fetch(at + 2, count * 12))
    if (!table) return null
    const tags = new Map()
    for (let i = 0; i < count; i++) {
      const p = i * 12
      const tag = u16(table, p)
      const type = u16(table, p + 2)
      const n = u32(table, p + 4)
      const unit = TYPE_SIZE[type]
      if (!unit || !n || tags.has(tag)) continue
      tags.set(tag, { type, count: n, at: unit * n <= 4 ? at + 2 + p + 8 : base + u32(table, p + 8) })
    }
    return { tags, next: table.length >= count * 12 + 4 ? u32(table, count * 12) : 0 }
  }

  function numberAt (type, b, i) {
    switch (type) {
      case 1: case 2: case 7: return b[i]
      case 6: return (b[i] << 24) >> 24
      case 3: return u16(b, i)
      case 8: return (u16(b, i) << 16) >> 16
      case 4: case 13: return u32(b, i)
      case 9: return u32(b, i) | 0
      case 5: {
        const d = u32(b, i + 4)
        return d ? u32(b, i) / d : NaN
      }
      case 10: {
        const d = u32(b, i + 4) | 0
        return d ? (u32(b, i) | 0) / d : NaN
      }
      case 11: return new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, little)
      case 12: return new DataView(b.buffer, b.byteOffset + i, 8).getFloat64(0, little)
    }
    return NaN
  }

  async function numbers (entry, max = 1) {
    if (!entry) return null
    const unit = TYPE_SIZE[entry.type]
    const n = Math.min(entry.count, max)
    const bytes = await fetch(entry.at, n * unit)
    if (!bytes) return null
    const found = []
    for (let i = 0; i < n; i++) found.push(numberAt(entry.type, bytes, i * unit))
    return found
  }

  async function text (entry, max = 128) {
    if (!entry || (entry.type !== 2 && entry.type !== 7 && entry.type !== 1)) return null
    const bytes = await fetch(entry.at, Math.min(entry.count, max))
    return bytes ? cleanString(bytes) : null
  }

  async function first (dir, tag) {
    const found = dir ? await numbers(dir.tags.get(tag), 1) : null
    return found && Number.isFinite(found[0]) ? found[0] : null
  }

  const ifd0 = await directory(u32(head, 4))
  if (!ifd0) return null
  const exif = await directory(await first(ifd0, 0x8769))
  const gps = await directory(await first(ifd0, 0x8825))
  const ifd1 = await directory(ifd0.next)
  const subs = []
  for (const offset of (await numbers(ifd0.tags.get(0x14a), 8)) || []) {
    const dir = await directory(offset)
    if (dir) subs.push(dir)
  }
  return { ifd0, ifd1, exif, gps, subs, numbers, text, first }
}

// Fills meta from a TIFF structure. size: take the pixel size from it (a TIFF
// or raw file). orientation: take the orientation from it (not for HEIF,
// whose own boxes say). previews: look for the largest embedded JPEG in IFD0,
// IFD1 and SubIFDs (raw files); else only IFD1's thumbnail.
async function readExifInto (meta, src, base, end, { size = false, orientation = true, previews = false } = {}) {
  const tiff = await readTiff(src, base, end)
  if (!tiff) return
  const { ifd0, ifd1, exif, gps, subs, numbers, text, first } = tiff
  const tag = (dir, id) => (dir ? dir.tags.get(id) : undefined)

  if (orientation) {
    const value = await first(ifd0, 0x112)
    if (value >= 1 && value <= 8) meta.orientation = value
  }
  meta.make = await text(tag(ifd0, 0x10f), 64)
  meta.model = await text(tag(ifd0, 0x110), 64)

  const original = exifTime(await text(tag(exif, 0x9003), 32))
  const digitized = original === null ? exifTime(await text(tag(exif, 0x9004), 32)) : null
  const plain = original === null && digitized === null ? exifTime(await text(tag(ifd0, 0x132), 32)) : null
  meta.taken = original ?? digitized ?? plain
  if (meta.taken !== null) {
    const own = original !== null ? 0x9011 : digitized !== null ? 0x9012 : 0x9010
    meta.offset = offsetOf(await text(tag(exif, own), 16)) ?? offsetOf(await text(tag(exif, 0x9011), 16)) ?? offsetOf(await text(tag(exif, 0x9010), 16))
  }

  meta.exposureTime = inRange(await first(exif, 0x829a), 100000)
  meta.fNumber = inRange(await first(exif, 0x829d), 1000)
  let iso = inRange(await first(exif, 0x8827), 10000000)
  // 65535 means "higher than a SHORT holds": ISOSpeed has the real value.
  if (iso === null || iso === 65535) iso = inRange(await first(exif, 0x8833), 10000000) ?? iso
  meta.iso = iso
  meta.focalLength = inRange(await first(exif, 0x920a), 100000)
  meta.focalLength35 = inRange(await first(exif, 0xa405), 100000)
  meta.lens = await text(tag(exif, 0xa434), 128)

  if (gps) {
    const lat = coordinate(await numbers(tag(gps, 2), 3), await text(tag(gps, 1), 4), 'S', 90)
    const lon = coordinate(await numbers(tag(gps, 4), 3), await text(tag(gps, 3), 4), 'W', 180)
    if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
      const altitude = await first(gps, 6)
      const below = (await first(gps, 5)) === 1
      meta.gps = { lat, lon, alt: Number.isFinite(altitude) && Math.abs(altitude) < 100000 ? (below ? -altitude : altitude) : null }
    }
  }

  if (size) {
    const x = inRange(await first(exif, 0xa002), 1000000)
    const y = inRange(await first(exif, 0xa003), 1000000)
    let best = x && y ? { w: x, h: y } : null
    if (!best) {
      for (const dir of [ifd0, ...subs]) {
        // Bit 0 of NewSubfileType marks a smaller copy of the image.
        const kind = await first(dir, 0xfe)
        if (kind !== null && (kind & 1)) continue
        const crop = await numbers(tag(dir, 0xc620), 2)
        const w = inRange(crop && crop[0], 1000000) ?? inRange(await first(dir, 0x100), 1000000)
        const h = inRange(crop && crop[1], 1000000) ?? inRange(await first(dir, 0x101), 1000000)
        if (w && h && (!best || w * h > best.w * best.h)) best = { w, h }
      }
    }
    if (best) {
      meta.width = Math.round(best.w)
      meta.height = Math.round(best.h)
    }
  }

  const candidates = []
  for (const dir of previews ? [ifd0, ifd1, ...subs] : [ifd1]) {
    if (!dir) continue
    const start = await first(dir, 0x201)
    const length = await first(dir, 0x202)
    if (start > 0 && length > 0) candidates.push({ offset: base + start, length, strip: false })
    if (!previews) continue
    // A JPEG kept as one strip. Raw sensor data can be JPEG too (lossless),
    // so CFA and linear raw images and Canon's raw slices are left out.
    const compression = await first(dir, 0x103)
    const photometric = await first(dir, 0x106)
    const offsets = tag(dir, 0x111)
    const counts = tag(dir, 0x117)
    if ((compression === 6 || compression === 7 || compression === 34892) && photometric !== 32803 && photometric !== 34892 &&
      !tag(dir, 0xc5d8) && offsets && counts && offsets.count === 1 && counts.count === 1) {
      const stripStart = await first(dir, 0x111)
      const stripLength = await first(dir, 0x117)
      if (stripStart > 0 && stripLength > 0) candidates.push({ offset: base + stripStart, length: stripLength, strip: true })
    }
    // Panasonic keeps its preview in tag 0x2e, JpgFromRaw.
    const embedded = tag(dir, 0x2e)
    if (embedded && (embedded.type === 7 || embedded.type === 1) && embedded.count > 4) {
      candidates.push({ offset: embedded.at, length: embedded.count, strip: true })
    }
  }
  candidates.sort((a, b) => b.length - a.length)
  for (const candidate of candidates) {
    if (candidate.length > MAX_PREVIEW || candidate.offset + candidate.length > Math.min(end, src.size)) continue
    let soi = src.peek(candidate.offset, 2)
    if (!soi && candidate.strip) {
      await src.load(candidate.offset, 2)
      soi = src.peek(candidate.offset, 2)
      if (!soi) continue
    }
    if (soi && (soi[0] !== 0xff || soi[1] !== 0xd8)) continue
    meta.thumbnail = { offset: candidate.offset, length: candidate.length }
    break
  }
}

async function readJpeg (src, meta, at) {
  let pos = at + 2
  let exif = false
  for (let count = 0; count < 300; count++) {
    const head = await src.need(pos, 4)
    if (!head || head[0] !== 0xff) return
    const marker = head[1]
    // Fill bytes, and markers without a length.
    if (marker === 0xff) {
      pos += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return
    const length = be16(head, 2)
    if (length < 2) return
    if (marker === 0xe1 && !exif && length >= 16) {
      const header = await src.need(pos + 4, 6)
      if (header && fourcc(header, 0) === 'Exif' && header[4] === 0) {
        exif = true
        // The whole segment at once, so the Exif reads come from memory.
        if (await src.need(pos + 4, length - 2)) await readExifInto(meta, src, pos + 10, pos + 2 + length)
      }
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const frame = await src.need(pos + 4, 5)
      if (frame) {
        meta.height = be16(frame, 1) || null
        meta.width = be16(frame, 3) || null
      }
      return
    }
    pos += 2 + length
  }
}

// Child boxes of bytes[from, to), as positions in bytes. Stops at the first
// box that does not fit. Shared with video-meta.js.
export function boxesIn (bytes, from, to, limit = 4096) {
  const found = []
  let pos = from
  while (pos + 8 <= to && found.length < limit) {
    let size = be32(bytes, pos)
    let header = 8
    if (size === 1) {
      if (pos + 16 > to) break
      size = be64(bytes, pos + 8)
      header = 16
    } else if (size === 0) {
      size = to - pos
    }
    if (size < header || pos + size > to) break
    found.push({ type: fourcc(bytes, pos + 4), start: pos, payload: pos + header, end: pos + size })
    pos += size
  }
  return found
}

// HEIF and AVIF transforms as 2x2 matrices, and the EXIF orientation each
// combination is.
const ROTATIONS = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]]
const MIRRORS = [[-1, 0, 0, 1], [1, 0, 0, -1]]
const ORIENTATIONS = { '1,0,0,1': 1, '-1,0,0,1': 2, '-1,0,0,-1': 3, '1,0,0,-1': 4, '0,1,1,0': 5, '0,-1,1,0': 6, '0,-1,-1,0': 7, '0,1,-1,0': 8 }

function times ([a, b, c, d], [e, f, g, h]) {
  return [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h]
}

async function readHeif (src, meta) {
  // The top-level boxes, by their headers, to find meta.
  let pos = 0
  let found = null
  for (let count = 0; count < 32 && pos + 8 <= src.size; count++) {
    const head = (await src.need(pos, 16)) || (await src.need(pos, 8))
    if (!head) return
    let size = be32(head, 0)
    let header = 8
    if (size === 1) {
      if (head.length < 16) return
      size = be64(head, 8)
      header = 16
    } else if (size === 0) {
      size = src.size - pos
    }
    if (!(size >= header) || !Number.isFinite(size)) return
    if (fourcc(head, 4) === 'meta') {
      found = { start: pos, header, size }
      break
    }
    pos += size
  }
  if (!found) return
  const length = Math.min(found.size, MAX_META_BOX)
  const bytes = src.peek(found.start, length) || (await src.need(found.start, length)) || src.peekUpTo(found.start, length)
  if (!bytes || bytes.length < found.header + 4) return
  const children = boxesIn(bytes, found.header + 4, bytes.length)

  let primary = null
  const types = new Map()
  const locations = new Map()
  const properties = []
  const associations = new Map()
  const describes = new Map()
  let idat = null
  for (const box of children) {
    const p = box.payload
    const version = bytes[p]
    if (box.type === 'pitm' && box.end - p >= 6) {
      primary = version === 0 ? be16(bytes, p + 4) : (box.end - p >= 8 ? be32(bytes, p + 4) : null)
    } else if (box.type === 'iinf') {
      const start = p + 4 + (version === 0 ? 2 : 4)
      for (const entry of boxesIn(bytes, start, box.end, 10000)) {
        const q = entry.payload
        const v = bytes[q]
        if (entry.type !== 'infe' || v < 2) continue
        const idSize = v === 2 ? 2 : 4
        if (q + 4 + idSize + 6 > entry.end) continue
        const id = idSize === 2 ? be16(bytes, q + 4) : be32(bytes, q + 4)
        types.set(id, fourcc(bytes, q + 4 + idSize + 2))
      }
    } else if (box.type === 'iloc') {
      readItemLocations(bytes, p, box.end, version, locations)
    } else if (box.type === 'iprp') {
      for (const inner of boxesIn(bytes, p, box.end)) {
        if (inner.type === 'ipco') properties.push(...boxesIn(bytes, inner.payload, inner.end, 4096))
        else if (inner.type === 'ipma') readAssociations(bytes, inner.payload, inner.end, associations)
      }
    } else if (box.type === 'iref') {
      for (const reference of boxesIn(bytes, p + 4, box.end, 10000)) {
        if (reference.type !== 'cdsc') continue
        const idSize = version === 0 ? 2 : 4
        let q = reference.payload
        if (q + idSize + 2 > reference.end) continue
        const from = idSize === 2 ? be16(bytes, q) : be32(bytes, q)
        const count = be16(bytes, q + idSize)
        q += idSize + 2
        for (let i = 0; i < count && q + idSize <= reference.end; i++, q += idSize) {
          describes.set(from, idSize === 2 ? be16(bytes, q) : be32(bytes, q))
        }
      }
    } else if (box.type === 'idat') {
      idat = found.start + box.payload
    }
  }

  // Size and turns of the primary image, in the order they apply.
  let matrix = ROTATIONS[0]
  for (const index of associations.get(primary) || []) {
    const box = properties[index - 1]
    if (!box) continue
    if (box.type === 'ispe' && box.end - box.payload >= 12) {
      meta.width = be32(bytes, box.payload + 4) || null
      meta.height = be32(bytes, box.payload + 8) || null
    } else if (box.type === 'irot' && box.end > box.payload) {
      matrix = times(ROTATIONS[bytes[box.payload] & 3], matrix)
    } else if (box.type === 'imir' && box.end > box.payload) {
      matrix = times(MIRRORS[bytes[box.payload] & 1], matrix)
    }
  }
  meta.orientation = ORIENTATIONS[matrix.join(',')] || 1

  // The Exif item: the one that describes the primary image, else any.
  let exifId = null
  for (const [id, type] of types) {
    if (type !== 'Exif') continue
    if (exifId === null || describes.get(id) === primary) exifId = id
  }
  const location = exifId === null ? null : locations.get(exifId)
  if (!location || location.extents.length !== 1) return
  const [extent] = location.extents
  let start
  if (location.method === 0) start = location.base + extent.offset
  else if (location.method === 1 && idat !== null) start = idat + location.base + extent.offset
  else return
  const itemLength = extent.length
  if (!(itemLength >= 8) || itemLength > MAX_EXIF_ITEM || !Number.isSafeInteger(start)) return
  const item = await src.need(start, itemLength)
  if (!item) return
  // Most items start with the offset of the TIFF header; some writers put
  // "Exif\0\0" or the header itself first.
  let tiff = start + 4 + be32(item, 0)
  if (fourcc(item, 0) === 'Exif') tiff = start + 6
  else if ((item[0] === 0x4d && item[1] === 0x4d) || (item[0] === 0x49 && item[1] === 0x49)) tiff = start
  await readExifInto(meta, src, tiff, start + itemLength, { orientation: false })
}

function readItemLocations (bytes, p, end, version, locations) {
  let q = p + 4
  if (q + 2 > end) return
  const offsetSize = bytes[q] >> 4
  const lengthSize = bytes[q] & 15
  const baseSize = bytes[q + 1] >> 4
  const indexSize = version === 1 || version === 2 ? bytes[q + 1] & 15 : 0
  q += 2
  const sized = (size) => {
    if (size === 0) return 0
    if (q + size > end || (size !== 4 && size !== 8)) return NaN
    const value = size === 4 ? be32(bytes, q) : be64(bytes, q)
    q += size
    return value
  }
  if (q + (version < 2 ? 2 : 4) > end) return
  const count = version < 2 ? be16(bytes, q) : be32(bytes, q)
  q += version < 2 ? 2 : 4
  for (let i = 0; i < count && i < 10000; i++) {
    const idSize = version < 2 ? 2 : 4
    if (q + idSize + (version === 1 || version === 2 ? 2 : 0) + 2 > end) return
    const id = idSize === 2 ? be16(bytes, q) : be32(bytes, q)
    q += idSize
    let method = 0
    if (version === 1 || version === 2) {
      method = be16(bytes, q) & 15
      q += 2
    }
    q += 2
    const base = sized(baseSize)
    if (q + 2 > end || !Number.isFinite(base)) return
    const extentCount = be16(bytes, q)
    q += 2
    // Fields of size 0 take no bytes, so a long list is stepped over, not walked.
    if (extentCount > 64) {
      q += extentCount * (indexSize + offsetSize + lengthSize)
      if (q > end) return
      locations.set(id, { method, base, extents: [] })
      continue
    }
    const extents = []
    for (let e = 0; e < extentCount; e++) {
      if (indexSize && !Number.isFinite(sized(indexSize))) return
      const offset = sized(offsetSize)
      const length = sized(lengthSize)
      if (!Number.isFinite(offset) || !Number.isFinite(length)) return
      extents.push({ offset, length })
    }
    locations.set(id, { method, base, extents })
  }
}

function readAssociations (bytes, p, end, associations) {
  if (p + 8 > end) return
  const version = bytes[p]
  const wide = bytes[p + 3] & 1
  let q = p + 4
  const count = be32(bytes, q)
  q += 4
  for (let i = 0; i < count && i < 10000; i++) {
    const idSize = version < 1 ? 2 : 4
    if (q + idSize + 1 > end) return
    const id = idSize === 2 ? be16(bytes, q) : be32(bytes, q)
    q += idSize
    const n = bytes[q]
    q += 1
    const indexes = []
    for (let a = 0; a < n; a++) {
      if (q + (wide ? 2 : 1) > end) return
      indexes.push(wide ? be16(bytes, q) & 0x7fff : bytes[q] & 0x7f)
      q += wide ? 2 : 1
    }
    associations.set(id, indexes)
  }
}

// II or MM, then 42, or the numbers Olympus and Panasonic raw files use.
function isTiffStart (b) {
  const little = b[0] === 0x49 && b[1] === 0x49
  if (!little && !(b[0] === 0x4d && b[1] === 0x4d)) return false
  const magic = little ? le16(b, 2) : be16(b, 2)
  return magic === 42 || magic === 0x4f52 || magic === 0x5352 || magic === 0x55
}

const isExifStart = (bytes) => bytes.length >= 6 && fourcc(bytes, 0) === 'Exif' && bytes[4] === 0

async function readPng (src, meta, first) {
  if (first.length < 24 || fourcc(first, 12) !== 'IHDR') return
  meta.width = be32(first, 16) || null
  meta.height = be32(first, 20) || null
  let pos = 8
  let pixels = false
  for (let count = 0; count < 1000; count++) {
    // Past the image data, only chunks already read are looked at.
    const head = pixels ? src.peek(pos, 8) : await src.need(pos, 8)
    if (!head) return
    const length = be32(head, 0)
    const type = fourcc(head, 4)
    if (type === 'IEND') return
    if (type === 'IDAT') pixels = true
    if (type === 'eXIf') {
      if (length > MAX_EXIF_ITEM) return
      const block = await src.need(pos + 8, length)
      if (block) await readExifInto(meta, src, pos + 8 + (isExifStart(block) ? 6 : 0), pos + 8 + length)
      return
    }
    pos += 12 + length
  }
}

async function readWebp (src, meta) {
  let pos = 12
  let exif = false
  for (let count = 0; count < 64; count++) {
    const head = await src.need(pos, 8)
    if (!head) return
    const type = fourcc(head, 0)
    const length = le32(head, 4)
    const start = pos + 8
    if (type === 'VP8X') {
      const data = await src.need(start, 10)
      if (!data) return
      exif = (data[0] & 0x08) !== 0
      meta.width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16))
      meta.height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16))
    } else if (type === 'VP8 ') {
      const data = await src.need(start, 10)
      if (data && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a && meta.width === null) {
        meta.width = le16(data, 6) & 0x3fff
        meta.height = le16(data, 8) & 0x3fff
      }
      if (!exif) return
    } else if (type === 'VP8L') {
      const data = await src.need(start, 5)
      if (data && data[0] === 0x2f && meta.width === null) {
        const bits = le32(data, 1)
        meta.width = (bits % 0x4000) + 1
        meta.height = (Math.floor(bits / 0x4000) % 0x4000) + 1
      }
      if (!exif) return
    } else if (type === 'EXIF') {
      if (length > MAX_EXIF_ITEM) return
      const block = await src.need(start, length)
      if (block) await readExifInto(meta, src, start + (isExifStart(block) ? 6 : 0), start + length)
      return
    }
    pos = start + length + (length % 2)
  }
}

/**
 * Details of a photo, from read(start, endInclusive) => Promise<ArrayBuffer>
 * and the file's size. Resolves to { format, width, height, orientation,
 * taken, offset, make, model, lens, exposureTime, fNumber, iso, focalLength,
 * focalLength35, gps, thumbnail }, any of them null. width and height are as
 * stored: swap them for orientations 5 to 8. taken is the wall-clock time as
 * Date.UTC(); offset is minutes east of UTC. thumbnail is { offset, length }
 * of an embedded JPEG for the caller to read. Reads the first 128 KB, then at
 * most two more small reads, never more than 1 MB. Rejects only when read()
 * does; a broken file resolves with nulls.
 */
export async function readImageMeta (read, options) {
  const meta = emptyMeta()
  const src = createByteSource(read, options && options.size)
  try {
    const first = await src.load(0, FIRST_READ)
    if (!first || first.length < 8) return meta
    if (first[0] === 0xff && first[1] === 0xd8 && first[2] === 0xff) {
      meta.format = 'jpeg'
      await readJpeg(src, meta, 0)
    } else if (isTiffStart(first)) {
      meta.format = 'tiff'
      await readExifInto(meta, src, 0, Infinity, { size: true, previews: true })
    } else if (first.length >= 12 && fourcc(first, 4) === 'ftyp') {
      const brand = fourcc(first, 8)
      if (brand === 'crx ') return meta
      meta.format = brand === 'avif' || brand === 'avis' ? 'avif' : 'heif'
      await readHeif(src, meta)
    } else if (first.length >= 8 && be32(first, 0) === 0x89504e47 && be32(first, 4) === 0x0d0a1a0a) {
      meta.format = 'png'
      await readPng(src, meta, first)
    } else if (first.length >= 12 && fourcc(first, 0) === 'RIFF' && fourcc(first, 8) === 'WEBP') {
      meta.format = 'webp'
      await readWebp(src, meta)
    } else if (first.length >= 10 && fourcc(first, 0) === 'GIF8') {
      meta.format = 'gif'
      meta.width = le16(first, 6) || null
      meta.height = le16(first, 8) || null
    } else if (first.length >= 26 && first[0] === 0x42 && first[1] === 0x4d) {
      meta.format = 'bmp'
      const header = le32(first, 14)
      meta.width = (header === 12 ? le16(first, 18) : Math.abs(le32(first, 18) | 0)) || null
      meta.height = (header === 12 ? le16(first, 20) : Math.abs(le32(first, 22) | 0)) || null
    } else if (first.length >= 92 && fourcc(first, 0) === 'FUJI' && String.fromCharCode(...first.subarray(0, 15)) === 'FUJIFILMCCD-RAW') {
      // Fujifilm RAF: a JPEG preview with the photo's Exif, at a place the
      // header gives.
      meta.format = 'raf'
      const at = be32(first, 84)
      const length = be32(first, 88)
      const soi = at > 0 && length > 0 && at + length <= src.size ? await src.need(at, 2) : null
      if (soi && soi[0] === 0xff && soi[1] === 0xd8) {
        await readJpeg(src, meta, at)
        meta.thumbnail = { offset: at, length }
      }
    }
  } catch (error) {
    if (src.failed) throw src.failed
  }
  return meta
}
