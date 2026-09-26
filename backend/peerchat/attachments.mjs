import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import b4a from 'b4a'

import {
  getHyperStoragePath,
  withHyperRuntimeForAddress,
  withHyperRuntimeOperation
} from '../hyper/runtime.mjs'
import { normalizePickedLocalFile } from '../hyper/local-file.mjs'
import { createHyperUrl, parseHyperUrl } from '../hyper/url.mjs'
import { normalizePeerChatRoomKey } from './protocol.mjs'

const ATTACHMENT_KEY_CONTEXT = 'peersky-chat:attachment:'
const DRIVE_NAME_CONTEXT = 'peersky-chat:drive:'
const MAGIC = b4a.from('PCA1')
const IV_BYTES = 12
const TAG_BYTES = 16
const ENVELOPE_BYTES = MAGIC.byteLength + IV_BYTES + TAG_BYTES

/**
 * PCA2, the framed layout.
 *
 *   "PCA2" | frame size, uint32 big-endian | 8 random bytes
 *   then, repeatedly: one frame's ciphertext, then its 16-byte tag
 *
 * PCA1 seals a file in one piece, which is fine for a photo and impossible for
 * a film: bare's aes-256-gcm holds every byte until final(), and desktop's
 * WebCrypto is one shot too, so sending or opening cost twice the file in
 * memory. A phone has nowhere to put four gigabytes.
 *
 * Framing seals a megabyte at a time, so memory stays flat however big the
 * file is. Each frame's nonce is the 8 random bytes followed by its index, and
 * the last frame sets the top bit of that index, so frames cannot be reordered
 * and a truncated file cannot pass as a whole one. The header is the additional
 * data on every frame, so the frame size cannot be edited either.
 *
 * There is always a last frame, even when the file divides evenly, so the count
 * is floor(size / frame) + 1.
 */
const FRAMED_MAGIC = b4a.from('PCA2')
const FRAME_COUNTER_BYTES = 4
const BASE_NONCE_BYTES = IV_BYTES - FRAME_COUNTER_BYTES
const FRAMED_HEADER_BYTES = FRAMED_MAGIC.byteLength + FRAME_COUNTER_BYTES + BASE_NONCE_BYTES
const FINAL_FRAME_FLAG = 0x80000000
export const ATTACHMENT_FRAME_BYTES = 1024 * 1024
const MAX_ATTACHMENT_FRAME_BYTES = 16 * 1024 * 1024

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024
/**
 * Where framing takes over from the single seal.
 *
 * Desktop only reads PCA1 today, so anything it could already open is still
 * written that way and nothing that works now stops working. Past this, a file
 * was not sendable at all before, so there is nothing to keep compatible.
 */
export const MAX_SINGLE_SEAL_BYTES = 100 * 1024 * 1024
const MAX_ATTACHMENT_LABEL = formatByteLimit(MAX_ATTACHMENT_BYTES)
const MAX_SINGLE_SEAL_LABEL = formatByteLimit(MAX_SINGLE_SEAL_BYTES)
// hyperblobs writes every chunk it is handed as one hypercore block, and
// hypercore refuses a block over 15 MB. Bare has no streaming aes-256-gcm:
// update() buffers and returns nothing, and final() hands back the entire
// ciphertext at once, so a video reached the drive as a single block and the
// send died with "Appended block exceeds the maximum suggested block size".
// Splitting here stores the same bytes in the blocks hyperblobs would have
// picked itself.
export const ATTACHMENT_BLOCK_BYTES = 64 * 1024
const CACHE_DIRECTORY_NAME = 'peerchat-attachment-cache'
let uploadTransition = Promise.resolve()
const pendingOpens = new Map()

export function attachmentDriveName (roomKey) {
  const normalizedRoomKey = requireRoomKey(roomKey)
  return `peerchat-${createHash('sha256')
    .update(DRIVE_NAME_CONTEXT + normalizedRoomKey)
    .digest('hex')
    .slice(0, 32)}`
}

export function deriveAttachmentKey (roomKey) {
  return createHash('sha256')
    .update(ATTACHMENT_KEY_CONTEXT + requireRoomKey(roomKey))
    .digest()
}

export function opaqueAttachmentPath (now = Date.now, random = randomBytes) {
  return `/${now()}-${b4a.toString(random(8), 'hex')}.bin`
}

export function isEncryptedAttachment (bytes) {
  return bytes instanceof Uint8Array &&
    bytes.byteLength >= ENVELOPE_BYTES &&
    MAGIC.every((byte, index) => bytes[index] === byte)
}

/** How many bytes a file of this size takes up once sealed, in either layout. */
export function singleSealedLength (byteLength) {
  return byteLength + ENVELOPE_BYTES
}

export function framedSealedLength (byteLength, frameBytes = ATTACHMENT_FRAME_BYTES) {
  const frames = Math.floor(byteLength / frameBytes) + 1
  return FRAMED_HEADER_BYTES + byteLength + frames * TAG_BYTES
}

/**
 * Whether a stored size could be this file sealed in frames.
 *
 * The frame size is declared in the file's own header, which has not been read
 * at this point, so the exact length is not knowable here. What is knowable is
 * that the overhead is a header and a whole number of tags, at least one. The
 * exact size is checked again against the file that comes out.
 */
export function isFramedSealedLength (storedSize, byteLength) {
  const overhead = storedSize - FRAMED_HEADER_BYTES - byteLength
  return overhead >= TAG_BYTES && overhead % TAG_BYTES === 0
}

export function sealedAttachmentLength (byteLength, options = {}) {
  return usesFraming(byteLength, options)
    ? framedSealedLength(byteLength, options.frameBytes || ATTACHMENT_FRAME_BYTES)
    : singleSealedLength(byteLength)
}

function usesFraming (byteLength, options = {}) {
  const limit = Number.isSafeInteger(options.singleSealLimit)
    ? options.singleSealLimit
    : MAX_SINGLE_SEAL_BYTES
  return byteLength > limit
}

function formatByteLimit (bytes) {
  const gigabytes = bytes / (1024 * 1024 * 1024)
  return gigabytes >= 1
    ? `${Math.round(gigabytes)} GB`
    : `${Math.round(bytes / (1024 * 1024))} MB`
}

function writeUint32BE (target, value, offset) {
  target[offset] = (value >>> 24) & 0xff
  target[offset + 1] = (value >>> 16) & 0xff
  target[offset + 2] = (value >>> 8) & 0xff
  target[offset + 3] = value & 0xff
}

function readUint32BE (source, offset) {
  return (source[offset] * 0x1000000) +
    (source[offset + 1] << 16) +
    (source[offset + 2] << 8) +
    source[offset + 3]
}

function startsWith (bytes, prefix) {
  return bytes.byteLength >= prefix.byteLength &&
    prefix.every((byte, index) => bytes[index] === byte)
}

function createFramedHeader (baseNonce, frameBytes) {
  const header = b4a.alloc(FRAMED_HEADER_BYTES)
  header.set(FRAMED_MAGIC, 0)
  writeUint32BE(header, frameBytes, FRAMED_MAGIC.byteLength)
  header.set(baseNonce, FRAMED_MAGIC.byteLength + FRAME_COUNTER_BYTES)
  return header
}

function frameNonce (baseNonce, index, isFinal) {
  if (index >= FINAL_FRAME_FLAG) throw new Error('PeerChat attachment has too many frames.')
  const nonce = b4a.alloc(IV_BYTES)
  nonce.set(baseNonce, 0)
  writeUint32BE(nonce, isFinal ? (index | FINAL_FRAME_FLAG) >>> 0 : index, BASE_NONCE_BYTES)
  return nonce
}

export function encryptAttachment (bytes, roomKey, iv = randomBytes(IV_BYTES)) {
  const cipher = createCipheriv('aes-256-gcm', deriveAttachmentKey(roomKey), iv)
  const ciphertext = b4a.concat([cipher.update(bytes), cipher.final()])
  return b4a.concat([MAGIC, iv, ciphertext, cipher.getAuthTag()])
}

export function decryptAttachment (bytes, roomKey) {
  if (!isEncryptedAttachment(bytes)) throw new Error('Not an encrypted PeerChat attachment.')
  const iv = bytes.subarray(MAGIC.byteLength, MAGIC.byteLength + IV_BYTES)
  const sealed = bytes.subarray(MAGIC.byteLength + IV_BYTES)
  const ciphertext = sealed.subarray(0, sealed.byteLength - TAG_BYTES)
  const tag = sealed.subarray(sealed.byteLength - TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveAttachmentKey(roomKey), iv)
    decipher.setAuthTag(tag)
    return b4a.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new Error('PeerChat attachment decryption failed.')
  }
}

export async function uploadPeerChatAttachment ({
  roomKey,
  fileUri,
  byteLength
} = {}, options = {}) {
  const normalizedRoomKey = normalizePeerChatRoomKey(roomKey)
  if (!normalizedRoomKey) return { ok: false, error: 'Invalid PeerChat room key.' }
  const localFile = normalizePickedLocalFile(fileUri, byteLength)
  if (!localFile) return { ok: false, error: 'Invalid attachment file.' }
  if (localFile.byteLength > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `PeerChat attachments must be ${MAX_ATTACHMENT_LABEL} or smaller.` }
  }

  return withUploadTransition(async () => {
    try {
      return await runWithRuntime(options, async (runtime) => {
        const drive = await runtime.getDrive(attachmentDriveName(normalizedRoomKey))
        const pathname = opaqueAttachmentPath(options.now, options.randomBytes)
        await writeEncryptedFile(drive, pathname, localFile, normalizedRoomKey, options)

        const storedEntry = await drive.entry(pathname)
        const expectedLength = sealedAttachmentLength(localFile.byteLength, options)
        if (storedEntry?.value?.blob?.byteLength !== expectedLength) {
          throw new Error('The encrypted attachment could not be verified.')
        }

        return {
          ok: true,
          item: {
            url: createHyperUrl(`hyper://${drive.id}/`, pathname),
            byteLength: localFile.byteLength
          }
        }
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

export async function openPeerChatAttachment ({
  roomKey,
  url,
  fileName,
  fileSize,
  encrypted
} = {}, options = {}) {
  const normalizedRoomKey = normalizePeerChatRoomKey(roomKey)
  if (!normalizedRoomKey) return { ok: false, error: 'Invalid PeerChat room key.' }
  const target = parseHyperUrl(url)
  if (target.error || target.pathname === '/' || target.pathname.endsWith('/')) {
    return { ok: false, error: target.error || 'Invalid PeerChat attachment URL.' }
  }

  const normalizedName = normalizeFilename(fileName)
  if (!normalizedName) return { ok: false, error: 'Invalid attachment name.' }
  if (encrypted !== true) return { ok: false, error: 'Attachment is not marked as encrypted.' }
  const expectedSize = Number.isSafeInteger(fileSize) && fileSize >= 0 ? fileSize : null
  if (expectedSize !== null && expectedSize > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `PeerChat attachments must be ${MAX_ATTACHMENT_LABEL} or smaller.` }
  }

  const openingKey = `${normalizedRoomKey}:${url}`
  const pending = pendingOpens.get(openingKey)
  if (pending) return pending

  const opening = runWithRuntime(options, async (runtime) => {
    const drive = await runtime.getDrive(target.driveAddress)
    const entry = await drive.entry(target.pathname)
    const storedSize = entry?.value?.blob?.byteLength
    if (!Number.isSafeInteger(storedSize) || storedSize < 1) {
      throw new Error('PeerChat attachment was not found.')
    }
    if (storedSize > framedSealedLength(MAX_ATTACHMENT_BYTES)) {
      throw new Error('PeerChat attachment is too large.')
    }

    const outputSize = expectedSize !== null ? expectedSize : storedSize - ENVELOPE_BYTES
    if (outputSize < 0) {
      throw new Error('PeerChat attachment size does not match the message.')
    }
    if (expectedSize !== null) {
      // A file of this size stores as one length or the other depending on how
      // it was sealed, and under a single frame the two are the same number.
      const singleLength = singleSealedLength(expectedSize)
      if (storedSize !== singleLength && !isFramedSealedLength(storedSize, expectedSize)) {
        throw new Error('PeerChat attachment size does not match the message.')
      }
      // Sealed in one piece, so opening it means holding it and its ciphertext
      // at once. Whoever sent it had the memory for that and this phone may not.
      if (storedSize === singleLength && expectedSize > MAX_SINGLE_SEAL_BYTES) {
        throw new Error(`This attachment was sent in one piece, so it only opens up to ${MAX_SINGLE_SEAL_LABEL} on a phone.`)
      }
    }

    const cachePath = getAttachmentCachePath(normalizedRoomKey, url, normalizedName, options.storagePath)
    if (existsSync(cachePath) && statSync(cachePath).size === outputSize) {
      return { ok: true, localUri: toFileUri(cachePath), byteLength: outputSize }
    }

    mkdirSync(getDirName(cachePath), { recursive: true })
    const temporaryPath = `${cachePath}.partial`
    rmSync(temporaryPath, { force: true })
    try {
      const source = drive.createReadStream(target.pathname)
      await pipeline(
        source,
        new AttachmentDecryptStream(normalizedRoomKey),
        createWriteStream(temporaryPath)
      )
      if (statSync(temporaryPath).size !== outputSize) {
        throw new Error('PeerChat attachment download was incomplete.')
      }
      rmSync(cachePath, { force: true })
      renameSync(temporaryPath, cachePath)
    } catch (error) {
      rmSync(temporaryPath, { force: true })
      throw error
    }

    return { ok: true, localUri: toFileUri(cachePath), byteLength: outputSize }
  }, target.driveAddress)
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
    .finally(() => pendingOpens.delete(openingKey))
  pendingOpens.set(openingKey, opening)
  return opening
}

class AttachmentEncryptStream extends Transform {
  // createCipher is injectable so a test can stand in the one-shot cipher Bare
  // gives us, which is the shape node's streaming one hides.
  constructor (roomKey, iv = randomBytes(IV_BYTES), createCipher = createCipheriv) {
    super()
    this.cipher = createCipher('aes-256-gcm', deriveAttachmentKey(roomKey), iv)
    this.push(MAGIC)
    this.push(iv)
  }

  _transform (chunk, encoding, callback) {
    try {
      this.push(this.cipher.update(chunk))
      callback()
    } catch (error) {
      callback(error)
    }
  }

  _flush (callback) {
    try {
      this.push(this.cipher.final())
      this.push(this.cipher.getAuthTag())
      callback()
    } catch (error) {
      callback(error)
    }
  }
}

export class AttachmentFrameEncryptStream extends Transform {
  constructor (roomKey, {
    baseNonce = randomBytes(BASE_NONCE_BYTES),
    frameBytes = ATTACHMENT_FRAME_BYTES,
    createCipher = createCipheriv
  } = {}) {
    super()
    this.key = deriveAttachmentKey(roomKey)
    this.createCipher = createCipher
    this.baseNonce = baseNonce
    this.frameBytes = frameBytes
    this.header = createFramedHeader(baseNonce, frameBytes)
    this.pending = []
    this.pendingBytes = 0
    this.frameIndex = 0
    this.push(this.header)
  }

  _transform (chunk, encoding, callback) {
    try {
      this.pending.push(b4a.from(chunk))
      this.pendingBytes += chunk.byteLength
      // Strictly more than a frame, never exactly: the leftover is what the
      // flush seals as the last frame, and there has to be one.
      while (this.pendingBytes >= this.frameBytes) {
        const merged = b4a.concat(this.pending)
        this.sealFrame(merged.subarray(0, this.frameBytes), false)
        const rest = merged.subarray(this.frameBytes)
        this.pending = rest.byteLength > 0 ? [rest] : []
        this.pendingBytes = rest.byteLength
      }
      callback()
    } catch (error) {
      callback(error)
    }
  }

  _flush (callback) {
    try {
      // Always emitted, even when empty, so a reader can tell a finished file
      // from one that stopped early.
      this.sealFrame(b4a.concat(this.pending), true)
      this.pending = []
      this.pendingBytes = 0
      callback()
    } catch (error) {
      callback(error)
    }
  }

  sealFrame (plaintext, isFinal) {
    const cipher = this.createCipher(
      'aes-256-gcm',
      this.key,
      frameNonce(this.baseNonce, this.frameIndex, isFinal)
    )
    cipher.setAAD(this.header)
    this.push(b4a.concat([cipher.update(plaintext), cipher.final()]))
    this.push(cipher.getAuthTag())
    this.frameIndex += 1
  }
}

/**
 * Cuts whatever it is handed into drive-sized blocks.
 *
 * The encrypt stream above emits what the cipher gives it, which on Bare is one
 * piece the size of the whole file, and hyperblobs turns every piece into one
 * hypercore block. The bytes that reach the drive are unchanged; only how they
 * are handed over is.
 */
export class AttachmentBlockStream extends Transform {
  _transform (chunk, encoding, callback) {
    const bytes = b4a.from(chunk)
    for (let offset = 0; offset < bytes.byteLength; offset += ATTACHMENT_BLOCK_BYTES) {
      this.push(bytes.subarray(offset, offset + ATTACHMENT_BLOCK_BYTES))
    }
    callback()
  }
}

/**
 * Reads either layout, chosen by the magic at the front.
 *
 * Both start with sixteen bytes, so a file is never ambiguous: "PCA1" is the
 * single seal every desktop build writes, "PCA2" is framed.
 */
export class AttachmentDecryptStream extends Transform {
  constructor (roomKey) {
    super()
    this.key = deriveAttachmentKey(roomKey)
    this.pending = b4a.alloc(0)
    this.layout = null
    // PCA1
    this.decipher = null
    // PCA2
    this.header = null
    this.baseNonce = null
    this.frameBytes = 0
    this.frameIndex = 0
  }

  _transform (chunk, encoding, callback) {
    try {
      this.pending = b4a.concat([this.pending, b4a.from(chunk)])
      this.readLayout()
      if (this.layout === 'single') this.drainSingle()
      else if (this.layout === 'framed') this.drainFrames()
      callback()
    } catch (error) {
      callback(describeDecryptFailure(error))
    }
  }

  _flush (callback) {
    try {
      if (this.layout === 'single') this.finishSingle()
      else if (this.layout === 'framed') this.finishFrames()
      else throw new Error('Encrypted PeerChat attachment is incomplete.')
      callback()
    } catch (error) {
      callback(describeDecryptFailure(error))
    }
  }

  readLayout () {
    if (this.layout) return

    if (startsWith(this.pending, MAGIC)) {
      if (this.pending.byteLength < MAGIC.byteLength + IV_BYTES) return
      const iv = this.pending.subarray(MAGIC.byteLength, MAGIC.byteLength + IV_BYTES)
      this.decipher = createDecipheriv('aes-256-gcm', this.key, iv)
      this.pending = this.pending.subarray(MAGIC.byteLength + IV_BYTES)
      this.layout = 'single'
      return
    }

    if (startsWith(this.pending, FRAMED_MAGIC)) {
      if (this.pending.byteLength < FRAMED_HEADER_BYTES) return
      this.header = b4a.from(this.pending.subarray(0, FRAMED_HEADER_BYTES))
      this.frameBytes = readUint32BE(this.header, FRAMED_MAGIC.byteLength)
      if (this.frameBytes < 1 || this.frameBytes > MAX_ATTACHMENT_FRAME_BYTES) {
        throw new Error('Invalid encrypted PeerChat attachment header.')
      }
      this.baseNonce = this.header.subarray(FRAMED_MAGIC.byteLength + FRAME_COUNTER_BYTES)
      this.pending = this.pending.subarray(FRAMED_HEADER_BYTES)
      this.layout = 'framed'
      return
    }

    // Not enough yet to tell, unless what is there already disagrees.
    if (this.pending.byteLength >= MAGIC.byteLength) {
      throw new Error('Invalid encrypted PeerChat attachment header.')
    }
  }

  drainSingle () {
    if (this.pending.byteLength <= TAG_BYTES) return
    const ciphertextEnd = this.pending.byteLength - TAG_BYTES
    this.push(this.decipher.update(this.pending.subarray(0, ciphertextEnd)))
    this.pending = this.pending.subarray(ciphertextEnd)
  }

  finishSingle () {
    if (this.pending.byteLength !== TAG_BYTES) {
      throw new Error('Encrypted PeerChat attachment is incomplete.')
    }
    this.decipher.setAuthTag(this.pending)
    this.push(this.decipher.final())
  }

  drainFrames () {
    const frame = this.frameBytes + TAG_BYTES
    // A full frame is only ever a middle one: the writer keeps the last frame
    // short, so anything this size has more behind it.
    while (this.pending.byteLength >= frame) {
      this.openFrame(this.pending.subarray(0, frame), false)
      this.pending = this.pending.subarray(frame)
    }
  }

  finishFrames () {
    if (this.pending.byteLength < TAG_BYTES) {
      throw new Error('Encrypted PeerChat attachment is incomplete.')
    }
    this.openFrame(this.pending, true)
    this.pending = b4a.alloc(0)
  }

  openFrame (frame, isFinal) {
    const ciphertext = frame.subarray(0, frame.byteLength - TAG_BYTES)
    const tag = frame.subarray(frame.byteLength - TAG_BYTES)
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      frameNonce(this.baseNonce, this.frameIndex, isFinal)
    )
    decipher.setAAD(this.header)
    decipher.setAuthTag(tag)
    this.push(b4a.concat([decipher.update(ciphertext), decipher.final()]))
    this.frameIndex += 1
  }
}

async function writeEncryptedFile (drive, pathname, localFile, roomKey, options) {
  if (options.writeEncryptedFile) {
    await options.writeEncryptedFile({ drive, pathname, localFile, roomKey })
    return
  }
  const stat = statSync(localFile.path)
  if (!stat.isFile() || stat.size !== localFile.byteLength) {
    throw new Error('The selected attachment changed before upload.')
  }
  await pipeline(
    createReadStream(localFile.path),
    createEncryptStream(roomKey, localFile.byteLength, options),
    new AttachmentBlockStream(),
    drive.createWriteStream(pathname)
  )
}

// A wrong key, a damaged frame and a forged tag all arrive here the same way,
// and none of them is worth describing any further than this.
function describeDecryptFailure (error) {
  const message = error instanceof Error ? error.message : ''
  return /header|incomplete|too many frames/i.test(message)
    ? error
    : new Error('PeerChat attachment decryption failed.')
}

function createEncryptStream (roomKey, byteLength, options) {
  if (!usesFraming(byteLength, options)) {
    return new AttachmentEncryptStream(roomKey, options.iv, options.createCipher)
  }
  return new AttachmentFrameEncryptStream(roomKey, {
    ...(options.baseNonce ? { baseNonce: options.baseNonce } : {}),
    ...(options.frameBytes ? { frameBytes: options.frameBytes } : {}),
    ...(options.createCipher ? { createCipher: options.createCipher } : {})
  })
}

function normalizeFilename (value) {
  if (typeof value !== 'string') return ''
  const sanitized = Array.from(value.trim())
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && (code < 127 || code > 159)
    })
    .join('')
    .replace(/[/\\?#]/g, '-')
    .replace(/^[. -]+|[. ]+$/g, '')
  return Array.from(sanitized).slice(0, 160).join('')
}

function getAttachmentCachePath (roomKey, url, fileName, suppliedStoragePath) {
  const storagePath = suppliedStoragePath || getHyperStoragePath() || '.'
  const fingerprint = createHash('sha256').update(`${roomKey}:${url}`).digest('hex').slice(0, 24)
  return `${String(storagePath).replace(/[/\\]+$/, '')}/${CACHE_DIRECTORY_NAME}/${fingerprint}-${fileName}`
}

function getDirName (path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index < 0 ? '.' : path.slice(0, index)
}

function toFileUri (path) {
  const normalized = String(path).replaceAll('\\', '/')
  return `file://${encodeURI(normalized.startsWith('/') ? normalized : `/${normalized}`)}`
}

function requireRoomKey (roomKey) {
  const normalized = normalizePeerChatRoomKey(roomKey)
  if (!normalized) throw new Error('Invalid PeerChat room key.')
  return normalized
}

function runWithRuntime (options, operation, address) {
  if (options.runtime) return operation(options.runtime)
  return address
    ? withHyperRuntimeForAddress(address, operation)
    : withHyperRuntimeOperation(operation)
}

function withUploadTransition (task) {
  const next = uploadTransition.then(task, task)
  uploadTransition = next.catch(() => {})
  return next
}
