import b4a from 'b4a'

// A zip of a few small entries, stored rather than compressed. It is what the
// desktop's transfer format expects on the outside, and everything a phone
// sends a desktop is small, so it is built in memory in one go.
const LOCAL_FILE_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50
const VERSION = 20
const UTF8_NAMES = 0x0800
const METHOD_STORE = 0
const MAX_ENTRY_BYTES = 0xffffffff

let crcTable = null

export function crc32 (bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** entries: [{ name, bytes }], in the order they are written. */
export function createStoredZip (entries, { now = new Date() } = {}) {
  const { time, date } = dosDateTime(now)
  const locals = []
  const centrals = []
  let offset = 0

  for (const entry of entries) {
    const name = b4a.from(String(entry.name), 'utf8')
    const bytes = b4a.isBuffer(entry.bytes) ? entry.bytes : b4a.from(entry.bytes)
    if (!name.byteLength || name.byteLength > 0xffff) throw new Error('Zip entry name is invalid')
    if (bytes.byteLength > MAX_ENTRY_BYTES) throw new Error('Zip entry is too large')
    const crc = crc32(bytes)

    const local = b4a.alloc(30)
    const view = new DataView(local.buffer, local.byteOffset, local.byteLength)
    view.setUint32(0, LOCAL_FILE_SIGNATURE, true)
    view.setUint16(4, VERSION, true)
    view.setUint16(6, UTF8_NAMES, true)
    view.setUint16(8, METHOD_STORE, true)
    view.setUint16(10, time, true)
    view.setUint16(12, date, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, bytes.byteLength, true)
    view.setUint32(22, bytes.byteLength, true)
    view.setUint16(26, name.byteLength, true)
    view.setUint16(28, 0, true)
    locals.push(local, name, bytes)

    const central = b4a.alloc(46)
    const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength)
    centralView.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true)
    centralView.setUint16(4, VERSION, true)
    centralView.setUint16(6, VERSION, true)
    centralView.setUint16(8, UTF8_NAMES, true)
    centralView.setUint16(10, METHOD_STORE, true)
    centralView.setUint16(12, time, true)
    centralView.setUint16(14, date, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, bytes.byteLength, true)
    centralView.setUint32(24, bytes.byteLength, true)
    centralView.setUint16(28, name.byteLength, true)
    centralView.setUint32(42, offset, true)
    centrals.push(central, name)

    offset += local.byteLength + name.byteLength + bytes.byteLength
    if (offset > MAX_ENTRY_BYTES) throw new Error('Zip is too large')
  }

  const centralSize = centrals.reduce((size, part) => size + part.byteLength, 0)
  const end = b4a.alloc(22)
  const endView = new DataView(end.buffer, end.byteOffset, end.byteLength)
  endView.setUint32(0, EOCD_SIGNATURE, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  return b4a.concat([...locals, ...centrals, end])
}

function dosDateTime (value) {
  const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date()
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107)
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  }
}
