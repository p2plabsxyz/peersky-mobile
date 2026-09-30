import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { createInflateRaw } from 'node:zlib'
import b4a from 'b4a'
import { MAX_BACKUP_SIZE_BYTES } from './limits.mjs'

// zip.mjs reads an archive that is already in memory. A desktop transfer can
// be hundreds of megabytes, and holding it, inflating it and decrypting it in
// memory meant several copies at once, which a phone does not survive. This
// reads the same archives straight from disk: the directory with positional
// reads, and each entry as a stream.
const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const LOCAL_FILE_SIGNATURE = 0x04034b50
const ZIP_METHOD_STORE = 0
const ZIP_METHOD_DEFLATE = 8
const READ_CHUNK_BYTES = 256 * 1024
// Smaller for compressed input, which can expand a long way in one step.
const DEFLATE_CHUNK_BYTES = 64 * 1024
const ZIP64_MARKER = 0xffffffff

export function openZipFile (filePath) {
  const fd = openSync(filePath, 'r')

  try {
    const fileSize = fstatSync(fd).size
    const entries = readCentralDirectory(fd, fileSize)
    return {
      entries,
      find: (name) => entries.find((entry) => entry.name === name) || null,
      readEntry: (entry, maxBytes = 8 * 1024 * 1024) => readEntry(fd, fileSize, entry, maxBytes),
      streamEntry: (entry, onChunk) => streamEntry(fd, fileSize, entry, onChunk),
      close: () => closeSync(fd)
    }
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

function readCentralDirectory (fd, fileSize) {
  if (fileSize < 22) throw new Error('Invalid ZIP file: end of central directory not found')

  const tailLength = Math.min(fileSize, 22 + 0xffff)
  const tail = readAt(fd, fileSize - tailLength, tailLength)
  let eocd = -1
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset
      break
    }
  }
  if (eocd === -1) throw new Error('Invalid ZIP file: end of central directory not found')

  const entryCount = tail.readUInt16LE(eocd + 10)
  const directorySize = tail.readUInt32LE(eocd + 12)
  const directoryOffset = tail.readUInt32LE(eocd + 16)
  if (directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER || entryCount === 0xffff) {
    throw new Error('This transfer is over 4 GB, which the phone cannot read. Clear cached P2P data on the desktop and send again.')
  }
  if (directoryOffset + directorySize > fileSize) throw new Error('ZIP central directory is invalid')

  const directory = readAt(fd, directoryOffset, directorySize)
  const entries = []
  let offset = 0
  let totalUncompressedSize = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > directory.byteLength || directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('ZIP central directory entry is invalid')
    }

    const flags = directory.readUInt16LE(offset + 8)
    const method = directory.readUInt16LE(offset + 10)
    const compressedSize = directory.readUInt32LE(offset + 20)
    const uncompressedSize = directory.readUInt32LE(offset + 24)
    const nameLength = directory.readUInt16LE(offset + 28)
    const extraLength = directory.readUInt16LE(offset + 30)
    const commentLength = directory.readUInt16LE(offset + 32)
    const localHeaderOffset = directory.readUInt32LE(offset + 42)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd > directory.byteLength) throw new Error('ZIP central directory entry is invalid')
    const name = b4a.toString(directory.subarray(offset + 46, nameEnd), 'utf8')
    const isDirectory = name.endsWith('/')

    if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
      throw new Error('This transfer is over 4 GB, which the phone cannot read. Clear cached P2P data on the desktop and send again.')
    }
    if (!isDirectory) {
      if (uncompressedSize > MAX_BACKUP_SIZE_BYTES) throw new Error(`ZIP entry exceeds 2GB limit: ${name}`)
      totalUncompressedSize += uncompressedSize
      if (totalUncompressedSize > MAX_BACKUP_SIZE_BYTES) throw new Error('ZIP contents exceed 2GB limit')
    }
    if ((flags & 0x1) !== 0) throw new Error(`ZIP entry is encrypted: ${name}`)

    entries.push({ name, flags, method, compressedSize, uncompressedSize, localHeaderOffset, isDirectory })
    offset = nameEnd + extraLength + commentLength
  }

  return entries
}

function dataOffsetFor (fd, fileSize, entry) {
  const header = readAt(fd, entry.localHeaderOffset, 30)
  if (header.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) throw new Error(`ZIP local header is invalid: ${entry.name}`)
  const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
  if (start + entry.compressedSize > fileSize) throw new Error(`ZIP entry data is truncated: ${entry.name}`)
  return start
}

async function streamEntry (fd, fileSize, entry, onChunk) {
  if (entry.isDirectory) return
  const start = dataOffsetFor(fd, fileSize, entry)

  if (entry.method === ZIP_METHOD_STORE) {
    if (entry.compressedSize !== entry.uncompressedSize) throw new Error(`ZIP entry size mismatch: ${entry.name}`)
    await forEachChunk(fd, start, entry.compressedSize, onChunk)
    return
  }

  if (entry.method !== ZIP_METHOD_DEFLATE) {
    throw new Error(`Unsupported ZIP compression method ${entry.method}: ${entry.name}`)
  }

  // The declared size is enforced as output arrives, not after a whole chunk
  // has been inflated: a few hundred kilobytes of crafted deflate data can
  // expand to hundreds of megabytes, and the first entry read, manifest.json,
  // is read before any signature has been checked. Bare's inflater also
  // enforces maxOutputLength itself.
  let produced = 0
  let failure = null
  const pending = []
  const inflater = createInflateRaw({ maxOutputLength: Math.max(1, entry.uncompressedSize) })
  inflater.on('data', (chunk) => {
    produced += chunk.byteLength
    if (produced > entry.uncompressedSize) {
      failure = failure || new Error(`ZIP entry size mismatch: ${entry.name}`)
      inflater.destroy(failure)
      return
    }
    pending.push(chunk)
  })
  inflater.on('error', (error) => { failure = failure || error })
  const ended = new Promise((resolve, reject) => {
    inflater.once('end', resolve)
    inflater.once('error', reject)
    inflater.once('close', () => (failure ? reject(failure) : resolve()))
  })
  // Watched from the start, so bad deflate data can never become an
  // unhandled rejection, which aborts a Bare worklet.
  ended.catch(() => {})

  async function flush () {
    if (failure) throw failure
    while (pending.length > 0) await onChunk(pending.shift())
  }

  try {
    await forEachChunk(fd, start, entry.compressedSize, async (chunk) => {
      const accepted = inflater.write(chunk)
      await flush()
      if (!accepted) await waitForDrain(inflater)
      await flush()
    }, DEFLATE_CHUNK_BYTES)
    inflater.end()
    await ended
    await flush()
  } catch (error) {
    inflater.destroy()
    throw failure || error
  }

  if (produced !== entry.uncompressedSize) throw new Error(`ZIP entry size mismatch: ${entry.name}`)
}

function waitForDrain (stream) {
  return new Promise((resolve, reject) => {
    const done = (callback) => (value) => {
      stream.off('drain', onDrain)
      stream.off('error', onError)
      stream.off('close', onClose)
      callback(value)
    }
    const onDrain = done(resolve)
    const onError = done(reject)
    const onClose = done(() => reject(new Error('The inflater closed before it drained')))
    stream.on('drain', onDrain)
    stream.on('error', onError)
    stream.on('close', onClose)
  })
}

async function readEntry (fd, fileSize, entry, maxBytes) {
  if (entry.uncompressedSize > maxBytes) throw new Error(`ZIP entry is too large: ${entry.name}`)
  const chunks = []
  await streamEntry(fd, fileSize, entry, (chunk) => { chunks.push(chunk) })
  return b4a.concat(chunks)
}

async function forEachChunk (fd, start, length, onChunk, chunkBytes = READ_CHUNK_BYTES) {
  let offset = 0
  while (offset < length) {
    const size = Math.min(chunkBytes, length - offset)
    await onChunk(readAt(fd, start + offset, size))
    offset += size
  }
}

function readAt (fd, position, length) {
  const buffer = b4a.alloc(length)
  let offset = 0
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, position + offset)
    if (read === 0) throw new Error('ZIP file is truncated')
    offset += read
  }
  return buffer
}
