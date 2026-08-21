import b4a from 'b4a'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50

const ZIP_METHOD_STORE = 0
const ZIP_METHOD_DEFLATE = 8

export function readZipEntries (zipBytes) {
  const bytes = toBuffer(zipBytes)
  const eocdOffset = findEndOfCentralDirectory(bytes)
  const entryCount = readUInt16LE(bytes, eocdOffset + 10)
  const centralDirectorySize = readUInt32LE(bytes, eocdOffset + 12)
  const centralDirectoryOffset = readUInt32LE(bytes, eocdOffset + 16)
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize

  if (centralDirectoryEnd > bytes.byteLength) {
    throw new Error('ZIP central directory is invalid')
  }

  const entries = []
  let offset = centralDirectoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32LE(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('ZIP central directory entry is invalid')
    }

    const flags = readUInt16LE(bytes, offset + 8)
    const method = readUInt16LE(bytes, offset + 10)
    const compressedSize = readUInt32LE(bytes, offset + 20)
    const uncompressedSize = readUInt32LE(bytes, offset + 24)

    const filenameLength = readUInt16LE(bytes, offset + 28)
    const extraLength = readUInt16LE(bytes, offset + 30)
    const commentLength = readUInt16LE(bytes, offset + 32)
    const localHeaderOffset = readUInt32LE(bytes, offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + filenameLength
    const name = b4a.toString(bytes.subarray(nameStart, nameEnd), 'utf8')

    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
      get bytes () {
        if (this.isDirectory) return new Uint8Array()
        return readEntryData(bytes, this)
      }
    })

    offset = nameEnd + extraLength + commentLength
  }

  return entries
}

export function readZipFile (zipBytes, name) {
  const entry = readZipEntries(zipBytes).find((candidate) => candidate.name === name)
  return entry ? entry.bytes : null
}

function readEntryData (zipBytes, entry) {
  if ((entry.flags & 0x1) !== 0) {
    throw new Error(`ZIP entry is encrypted: ${entry.name}`)
  }

  if (readUInt32LE(zipBytes, entry.localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`ZIP local header is invalid: ${entry.name}`)
  }

  const filenameLength = readUInt16LE(zipBytes, entry.localHeaderOffset + 26)
  const extraLength = readUInt16LE(zipBytes, entry.localHeaderOffset + 28)
  const dataStart = entry.localHeaderOffset + 30 + filenameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize

  if (dataEnd > zipBytes.byteLength) {
    throw new Error(`ZIP entry data is truncated: ${entry.name}`)
  }

  const compressed = zipBytes.subarray(dataStart, dataEnd)

  if (entry.method === ZIP_METHOD_STORE) {
    return copyBytes(compressed)
  }

  if (entry.method === ZIP_METHOD_DEFLATE) {
    const inflated = inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize })
    if (inflated.byteLength !== entry.uncompressedSize) {
      throw new Error(`ZIP entry size mismatch: ${entry.name}`)
    }
    return copyBytes(inflated)
  }

  throw new Error(`Unsupported ZIP compression method ${entry.method}: ${entry.name}`)
}

function findEndOfCentralDirectory (bytes) {
  const minOffset = Math.max(0, bytes.byteLength - 22 - 0xffff)

  for (let offset = bytes.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32LE(bytes, offset) === EOCD_SIGNATURE) return offset
  }

  throw new Error('Invalid ZIP file: end of central directory not found')
}

function readUInt16LE (bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUInt32LE (bytes, offset) {
  return (
    (bytes[offset]) |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] * 0x1000000)
  ) >>> 0
}

function toBuffer (bytes) {
  if (b4a.isBuffer(bytes)) return bytes
  return b4a.from(bytes)
}

function copyBytes (bytes) {
  const out = new Uint8Array(bytes.byteLength)
  out.set(bytes)
  return out
}
