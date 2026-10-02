// node:fs and node:crypto, not bare-fs and bare-crypto: backend/bare-imports.json
// maps them at bundle time, and importing the bare ones directly would make
// this untestable under node.
import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs'
import { createHash } from 'node:crypto'
import b4a from 'b4a'
import sodium from 'sodium-native'

// The file a phone backup or a phone-to-phone transfer lives in:
//
//   "PEERSKY-BACKUP\n"   15 bytes, readable if somebody opens it by mistake
//   format version       1 byte
//   manifest length      u32 little endian, always MANIFEST_AREA_BYTES
//   manifest             JSON, padded with spaces to the full area
//   payload              secretstream header, then frames of
//                        [u32 length][ciphertext]
//
// Not the desktop's zip: it needs a CRC32 per entry, the phone has no native
// one, and a JavaScript one crawls through gigabytes. Not its AES-GCM:
// bare-crypto's GCM holds the whole payload in memory, twice. Secretstream
// seals one 64 KiB frame at a time and marks the last, so a cut-off file is
// caught. The manifest's fixed area at the front lets it be written last, once
// the payload's hash and signature exist, without copying the payload.
export const BACKUP_FILE_MAGIC = 'PEERSKY-BACKUP\n'
export const BACKUP_FILE_FORMAT = 1
export const MANIFEST_AREA_BYTES = 16 * 1024
export const PAYLOAD_OFFSET = BACKUP_FILE_MAGIC.length + 1 + 4 + MANIFEST_AREA_BYTES
export const FRAME_PLAINTEXT_BYTES = 64 * 1024
export const PAYLOAD_ALGORITHM = 'xchacha20poly1305-secretstream'

const MAGIC_BYTES = b4a.from(BACKUP_FILE_MAGIC)
const HEADER_BYTES = sodium.crypto_secretstream_xchacha20poly1305_HEADERBYTES
const STATE_BYTES = sodium.crypto_secretstream_xchacha20poly1305_STATEBYTES
const A_BYTES = sodium.crypto_secretstream_xchacha20poly1305_ABYTES
const TAG_MESSAGE = sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE
const TAG_FINAL = sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL
const MAX_FRAME_BYTES = FRAME_PLAINTEXT_BYTES + A_BYTES
// Every so many bytes the work stops for a tick, so the progress the app is
// shown can actually leave the worklet while a large backup is written.
const YIELD_EVERY_BYTES = 4 * 1024 * 1024

export function isBackupFileHeader (bytes) {
  if (!bytes || bytes.byteLength < MAGIC_BYTES.byteLength) return false
  return b4a.equals(bytes.subarray(0, MAGIC_BYTES.byteLength), MAGIC_BYTES)
}

export function isZipHeader (bytes) {
  return Boolean(bytes && bytes.byteLength >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)
}

export function readFileHead (filePath, length = MAGIC_BYTES.byteLength) {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = b4a.alloc(length)
    const read = readSync(fd, buffer, 0, length, 0)
    return buffer.subarray(0, read)
  } finally {
    closeSync(fd)
  }
}

/**
 * Opens a backup file for writing and returns a writer for its payload. The
 * manifest is written by finish(), which is handed everything the payload
 * produced (byte count and SHA-256) so the manifest can describe it.
 */
export function createBackupFileWriter (filePath, key) {
  if (!key || key.byteLength !== sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES) {
    throw new Error('Backup key must be 32 bytes')
  }

  const fd = openSync(filePath, 'w')
  const state = b4a.alloc(STATE_BYTES)
  const header = b4a.alloc(HEADER_BYTES)
  const hash = createHash('sha256')
  const pending = b4a.alloc(FRAME_PLAINTEXT_BYTES)
  const lengthPrefix = b4a.alloc(4)
  let pendingLength = 0
  let position = PAYLOAD_OFFSET
  let payloadBytes = 0
  let sinceYield = 0
  let closed = false

  try {
    // The manifest area is reserved now and filled in at the end.
    writeAll(fd, b4a.alloc(PAYLOAD_OFFSET, 0x20), 0)
    sodium.crypto_secretstream_xchacha20poly1305_init_push(state, header, key)
    appendPayload(header)
  } catch (error) {
    closeSync(fd)
    throw error
  }

  function appendPayload (bytes) {
    writeAll(fd, bytes, position)
    hash.update(bytes)
    position += bytes.byteLength
    payloadBytes += bytes.byteLength
    sinceYield += bytes.byteLength
  }

  function sealFrame (tag) {
    const message = pending.subarray(0, pendingLength)
    const ciphertext = b4a.alloc(message.byteLength + A_BYTES)
    sodium.crypto_secretstream_xchacha20poly1305_push(state, ciphertext, message, null, tag)
    lengthPrefix.writeUInt32LE(ciphertext.byteLength, 0)
    appendPayload(lengthPrefix)
    appendPayload(ciphertext)
    pendingLength = 0
  }

  return {
    async write (bytes) {
      if (closed) throw new Error('Backup file is already finished')
      let offset = 0
      while (offset < bytes.byteLength) {
        const take = Math.min(FRAME_PLAINTEXT_BYTES - pendingLength, bytes.byteLength - offset)
        pending.set(bytes.subarray(offset, offset + take), pendingLength)
        pendingLength += take
        offset += take
        if (pendingLength === FRAME_PLAINTEXT_BYTES) sealFrame(TAG_MESSAGE)
      }
      if (sinceYield >= YIELD_EVERY_BYTES) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    },

    // buildManifest receives { payloadBytes, payloadSha256 } and returns the
    // manifest object to store.
    finish (buildManifest) {
      if (closed) throw new Error('Backup file is already finished')
      closed = true
      try {
        sealFrame(TAG_FINAL)
        const manifest = buildManifest({
          payloadBytes,
          payloadSha256: hash.digest('hex')
        })
        writeManifestArea(fd, manifest)
        return { bytes: position, manifest }
      } finally {
        closeSync(fd)
      }
    },

    abort () {
      if (closed) return
      closed = true
      try { closeSync(fd) } catch {}
    }
  }
}

export function readBackupFileManifest (filePath) {
  const fd = openSync(filePath, 'r')
  try {
    return readManifestFromFd(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Decrypts the payload one frame at a time and hands each plaintext chunk to
 * onChunk. Throws if a frame fails to authenticate, if the file ends before
 * the final frame, or if anything follows it.
 */
export async function readBackupFilePayload (filePath, key, { onChunk, onProgress } = {}) {
  if (!key || key.byteLength !== sodium.crypto_secretstream_xchacha20poly1305_KEYBYTES) {
    throw new Error('Backup key must be 32 bytes')
  }

  const fd = openSync(filePath, 'r')
  try {
    const fileSize = fstatSync(fd).size
    let position = PAYLOAD_OFFSET
    const hash = createHash('sha256')
    const header = readExactly(fd, HEADER_BYTES, position, 'Backup file is cut short')
    hash.update(header)
    position += HEADER_BYTES

    const state = b4a.alloc(STATE_BYTES)
    try {
      sodium.crypto_secretstream_xchacha20poly1305_init_pull(state, header, key)
    } catch {
      throw new Error('Backup file header is invalid')
    }

    const tag = b4a.alloc(1)
    let finished = false
    let sinceYield = 0

    while (position < fileSize) {
      if (finished) throw new Error('Backup file has data after its end')
      const lengthBytes = readExactly(fd, 4, position, 'Backup file is cut short')
      const frameLength = lengthBytes.readUInt32LE(0)
      if (frameLength < A_BYTES || frameLength > MAX_FRAME_BYTES) {
        throw new Error('Backup file is damaged')
      }
      const ciphertext = readExactly(fd, frameLength, position + 4, 'Backup file is cut short')
      hash.update(lengthBytes)
      hash.update(ciphertext)
      position += 4 + frameLength

      const message = b4a.alloc(frameLength - A_BYTES)
      try {
        sodium.crypto_secretstream_xchacha20poly1305_pull(state, message, tag, ciphertext, null)
      } catch {
        // The key was checked before any frame was read, so a frame that does
        // not authenticate means the file itself changed.
        throw new Error('Backup file is damaged')
      }
      if (tag[0] === TAG_FINAL) finished = true
      else if (tag[0] !== TAG_MESSAGE) throw new Error('Backup file is damaged')

      if (message.byteLength > 0 && onChunk) await onChunk(message)
      if (onProgress) onProgress(position - PAYLOAD_OFFSET, fileSize - PAYLOAD_OFFSET)

      sinceYield += frameLength
      if (sinceYield >= YIELD_EVERY_BYTES) {
        sinceYield = 0
        await yieldToEventLoop()
      }
    }

    if (!finished) throw new Error('Backup file is incomplete. It was cut off before the end.')
    return { payloadSha256: hash.digest('hex'), payloadBytes: position - PAYLOAD_OFFSET }
  } finally {
    closeSync(fd)
  }
}

function writeManifestArea (fd, manifest) {
  const json = b4a.from(JSON.stringify(manifest))
  if (json.byteLength > MANIFEST_AREA_BYTES) throw new Error('Backup manifest is too large')

  const area = b4a.alloc(PAYLOAD_OFFSET, 0x20)
  area.set(MAGIC_BYTES, 0)
  area[MAGIC_BYTES.byteLength] = BACKUP_FILE_FORMAT
  area.writeUInt32LE(MANIFEST_AREA_BYTES, MAGIC_BYTES.byteLength + 1)
  area.set(json, MAGIC_BYTES.byteLength + 5)
  writeAll(fd, area, 0)
}

function readManifestFromFd (fd) {
  const head = readExactly(fd, PAYLOAD_OFFSET, 0, 'Not a PeerSky backup file')
  if (!isBackupFileHeader(head)) throw new Error('Not a PeerSky backup file')
  if (head[MAGIC_BYTES.byteLength] !== BACKUP_FILE_FORMAT) {
    throw new Error('This backup was made by a newer PeerSky. Update the app, then try again.')
  }
  if (head.readUInt32LE(MAGIC_BYTES.byteLength + 1) !== MANIFEST_AREA_BYTES) {
    throw new Error('Backup file is damaged')
  }

  const text = b4a.toString(head.subarray(MAGIC_BYTES.byteLength + 5), 'utf8').trim()
  try {
    const manifest = JSON.parse(text)
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('bad')
    return manifest
  } catch {
    throw new Error('Backup file is damaged')
  }
}

function readExactly (fd, length, position, message) {
  const buffer = b4a.alloc(length)
  let offset = 0
  while (offset < length) {
    const read = readSync(fd, buffer, offset, length - offset, position + offset)
    if (read === 0) throw new Error(message)
    offset += read
  }
  return buffer
}

function writeAll (fd, bytes, position) {
  let offset = 0
  while (offset < bytes.byteLength) {
    offset += writeSync(fd, bytes, offset, bytes.byteLength - offset, position + offset)
  }
}

function yieldToEventLoop () {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
