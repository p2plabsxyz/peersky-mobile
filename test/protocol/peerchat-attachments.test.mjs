import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import {
  ATTACHMENT_BLOCK_BYTES,
  AttachmentBlockStream,
  AttachmentDecryptStream,
  AttachmentFrameEncryptStream,
  FREE_SPACE_RESERVE_BYTES,
  MAX_SINGLE_SEAL_BYTES,
  framedSealedLength,
  sealedAttachmentLength,
  singleSealedLength,
  attachmentDriveName,
  decryptAttachment,
  deriveAttachmentKey,
  encryptAttachment,
  isEncryptedAttachment,
  openPeerChatAttachment,
  opaqueAttachmentPath,
  uploadPeerChatAttachment
} from '../../backend/peerchat/attachments.mjs'

const ROOM_KEY = 'ab'.repeat(32)
const OTHER_ROOM_KEY = 'cd'.repeat(32)
const DRIVE_ID = 'a'.repeat(52)

test('PeerChat attachment crypto matches the desktop wire contract', () => {
  const expectedDriveName = `peerchat-${createHash('sha256')
    .update(`peersky-chat:drive:${ROOM_KEY}`)
    .digest('hex')
    .slice(0, 32)}`
  assert.equal(attachmentDriveName(ROOM_KEY.toUpperCase()), expectedDriveName)
  assert.deepEqual(
    deriveAttachmentKey(ROOM_KEY),
    createHash('sha256').update(`peersky-chat:attachment:${ROOM_KEY}`).digest()
  )

  const plaintext = Buffer.from('private room attachment')
  const encrypted = encryptAttachment(plaintext, ROOM_KEY, Buffer.alloc(12, 7))
  assert.equal(encrypted.subarray(0, 4).toString(), 'PCA1')
  assert.equal(isEncryptedAttachment(encrypted), true)
  assert.deepEqual(decryptAttachment(encrypted, ROOM_KEY), plaintext)
  assert.throws(() => decryptAttachment(encrypted, OTHER_ROOM_KEY), /decryption failed/)
  assert.match(opaqueAttachmentPath(() => 123, () => Buffer.alloc(8, 9)), /^\/123-0909090909090909[.]bin$/)
})

test('PeerChat streams encrypted files through a room-specific drive and decrypts on open', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-attachment-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pickerDirectory = path.join(root, 'cache', 'documentpicker')
  await mkdir(pickerDirectory, { recursive: true })
  const sourcePath = path.join(pickerDirectory, 'report.txt')
  const plaintext = Buffer.from('streamed attachment contents')
  await writeFile(sourcePath, plaintext)

  const stored = new Map()
  const drive = {
    id: DRIVE_ID,
    createWriteStream (pathname) {
      const chunks = []
      return new Writable({
        write (chunk, encoding, callback) {
          chunks.push(Buffer.from(chunk))
          callback()
        },
        final (callback) {
          stored.set(pathname, Buffer.concat(chunks))
          callback()
        }
      })
    },
    createReadStream (pathname) {
      return Readable.from([stored.get(pathname).subarray(0, 9), stored.get(pathname).subarray(9)])
    },
    async entry (pathname) {
      const bytes = stored.get(pathname)
      return bytes ? { value: { blob: { byteLength: bytes.byteLength } } } : null
    }
  }
  const requestedDrives = []
  const runtime = {
    async getDrive (name) {
      requestedDrives.push(name)
      return drive
    }
  }

  const uploaded = await uploadPeerChatAttachment({
    roomKey: ROOM_KEY,
    fileUri: pathToFileURL(sourcePath).toString(),
    byteLength: plaintext.byteLength
  }, {
    runtime,
    now: () => 123,
    randomBytes: () => Buffer.alloc(8, 9)
  })
  assert.equal(uploaded.ok, true)
  assert.equal(requestedDrives[0], attachmentDriveName(ROOM_KEY))
  assert.equal(isEncryptedAttachment(stored.values().next().value), true)
  assert.equal(stored.values().next().value.includes(plaintext), false)

  const opened = await openPeerChatAttachment({
    roomKey: ROOM_KEY,
    url: uploaded.item.url,
    fileName: 'report.txt',
    fileSize: plaintext.byteLength,
    encrypted: true
  }, { runtime, storagePath: root })
  assert.equal(opened.ok, true)
  assert.deepEqual(await readFile(new URL(opened.localUri)), plaintext)

  const wrongRoom = await openPeerChatAttachment({
    roomKey: OTHER_ROOM_KEY,
    url: uploaded.item.url,
    fileName: 'report.txt',
    fileSize: plaintext.byteLength,
    encrypted: true
  }, { runtime, storagePath: root })
  assert.equal(wrongRoom.ok, false)
  assert.match(wrongRoom.error, /decryption failed/)
})

// Sending a 142 MB video failed with "BAD_ARGUMENT: Appended block exceeds the
// maximum suggested block size". hyperblobs stores each chunk it is written as
// one hypercore block, and Bare's aes-256-gcm has no streaming mode: update()
// buffers and returns nothing, final() returns the entire ciphertext. So the
// whole video arrived as a single block. Node's cipher does stream, which is
// why this only ever showed up on the phone, so the one-shot shape is stood in
// here on purpose.
const MAX_SUGGESTED_BLOCK_SIZE = 15 * 1024 * 1024

function createOneShotCipher (algorithm, key, iv) {
  const pending = []
  let authTag = null
  let additionalData = null
  return {
    setAAD (bytes) {
      additionalData = Buffer.from(bytes)
    },
    update (chunk) {
      pending.push(Buffer.from(chunk))
      return Buffer.alloc(0)
    },
    final () {
      const cipher = createCipheriv(algorithm, key, iv)
      if (additionalData) cipher.setAAD(additionalData)
      const sealed = Buffer.concat([cipher.update(Buffer.concat(pending)), cipher.final()])
      authTag = cipher.getAuthTag()
      return sealed
    },
    getAuthTag () {
      return authTag
    }
  }
}

test('a ciphertext handed over in one piece is stored in drive-sized blocks', async () => {
  const oversized = Buffer.alloc(MAX_SUGGESTED_BLOCK_SIZE + 1024, 3)
  const blocks = []
  await pipeline(
    Readable.from([oversized]),
    new AttachmentBlockStream(),
    new Writable({
      write (chunk, encoding, callback) {
        blocks.push(Buffer.from(chunk))
        callback()
      }
    })
  )

  assert.ok(blocks.length > 1)
  for (const block of blocks) {
    assert.ok(block.byteLength <= ATTACHMENT_BLOCK_BYTES)
    assert.ok(block.byteLength <= MAX_SUGGESTED_BLOCK_SIZE)
  }
  assert.deepEqual(Buffer.concat(blocks), oversized)
})

test('an empty write reaches the drive as nothing at all', async () => {
  const blocks = []
  await pipeline(
    Readable.from([Buffer.alloc(0), Buffer.from('tail')]),
    new AttachmentBlockStream(),
    new Writable({
      write (chunk, encoding, callback) {
        blocks.push(Buffer.from(chunk))
        callback()
      }
    })
  )

  assert.deepEqual(blocks, [Buffer.from('tail')])
})

test('a one-shot cipher still uploads and opens, in blocks a drive accepts', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-blocks-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pickerDirectory = path.join(root, 'cache', 'imagepicker')
  await mkdir(pickerDirectory, { recursive: true })
  const sourcePath = path.join(pickerDirectory, 'clip.mp4')
  // Small enough to stay quick, large enough that one piece is several blocks.
  const plaintext = Buffer.alloc(320 * 1024, 11)
  await writeFile(sourcePath, plaintext)

  const stored = new Map()
  const written = new Map()
  const drive = {
    id: DRIVE_ID,
    createWriteStream (pathname) {
      const chunks = []
      return new Writable({
        write (chunk, encoding, callback) {
          chunks.push(Buffer.from(chunk))
          callback()
        },
        final (callback) {
          written.set(pathname, chunks.map((chunk) => chunk.byteLength))
          stored.set(pathname, Buffer.concat(chunks))
          callback()
        }
      })
    },
    createReadStream (pathname) {
      return Readable.from([stored.get(pathname)])
    },
    async entry (pathname) {
      const bytes = stored.get(pathname)
      return bytes ? { value: { blob: { byteLength: bytes.byteLength } } } : null
    }
  }
  const runtime = { async getDrive () { return drive } }

  const uploaded = await uploadPeerChatAttachment({
    roomKey: ROOM_KEY,
    fileUri: pathToFileURL(sourcePath).toString(),
    byteLength: plaintext.byteLength
  }, { runtime, createCipher: createOneShotCipher })
  assert.equal(uploaded.ok, true)

  // The whole ciphertext arrives from the cipher as one piece, so this is what
  // says the splitter is still in the pipeline and not just in the file.
  const blockSizes = [...written.values()][0]
  assert.ok(blockSizes.length > 1)
  for (const size of blockSizes) assert.ok(size <= ATTACHMENT_BLOCK_BYTES)

  const opened = await openPeerChatAttachment({
    roomKey: ROOM_KEY,
    url: uploaded.item.url,
    fileName: 'clip.mp4',
    fileSize: plaintext.byteLength,
    encrypted: true
  }, { runtime, storagePath: root })
  assert.equal(opened.ok, true)
  assert.deepEqual(await readFile(new URL(opened.localUri)), plaintext)
})

// No limit of its own, as in Keet. What stops a file is room: this phone keeps
// a sealed copy of what it shares, so a file it has no room for is refused,
// in plain words, before anything is written.
test('a file of any size is shared if there is room for it, and refused in plain words if not', async () => {
  const gb = 1024 * 1024 * 1024
  const big = 5 * gb
  const noDrive = { async getDrive () { throw new Error('should not reach the drive') } }

  const refused = await uploadPeerChatAttachment({
    roomKey: ROOM_KEY,
    fileUri: 'file:///var/mobile/Library/Caches/imagepicker/huge.mov',
    byteLength: big
  }, { runtime: noDrive, storagePath: '/tmp/peerchat-room-check', freeBytes: () => 3 * gb })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /^This phone needs 5\.5 GB free to share this file, and has 3\.0 GB\.$/)

  // With room, a file past the old 2 GB line goes on to the drive.
  const reached = await uploadPeerChatAttachment({
    roomKey: ROOM_KEY,
    fileUri: 'file:///var/mobile/Library/Caches/imagepicker/huge.mov',
    byteLength: big
  }, { runtime: noDrive, storagePath: '/tmp/peerchat-room-check', freeBytes: () => big * 2 })
  assert.equal(reached.ok, false)
  assert.equal(reached.error, 'should not reach the drive')
  assert.equal(FREE_SPACE_RESERVE_BYTES, 512 * 1024 * 1024)
})

// Opening keeps what came down and the opened copy, so a file too big for this
// phone, or a message claiming one, is refused before a byte is fetched.
test('a file is opened only if there is room for it', async () => {
  const gb = 1024 * 1024 * 1024
  const refused = await openPeerChatAttachment({
    roomKey: ROOM_KEY,
    url: 'hyper://' + 'a'.repeat(52) + '/1-abc.bin',
    fileName: 'film.mp4',
    fileSize: 3 * gb,
    encrypted: true
  }, {
    storagePath: '/tmp/peerchat-room-check',
    freeBytes: () => 4 * gb,
    runtime: {
      async getDrive () {
        return {
          async entry () { return { value: { blob: { byteLength: framedSealedLength(3 * gb) } } } },
          createReadStream () { throw new Error('should not download') }
        }
      }
    }
  })
  assert.equal(refused.ok, false)
  assert.match(refused.error, /^This phone needs 6\.5 GB free to open this file, and has 4\.0 GB\.$/)
})

// PCA1 seals a file in one piece on both sides, so sending or opening one costs
// twice the file in memory and 2 GB was never going to happen on a phone. PCA2
// seals a frame at a time, so memory stays flat whatever the size. Small frames
// here to keep the tests quick; the real one is a megabyte.
const FRAME_BYTES = 512
const FRAMED = { frameBytes: FRAME_BYTES, singleSealLimit: 0 }

async function sealFramed (bytes, roomKey = ROOM_KEY, options = {}) {
  const out = []
  await pipeline(
    Readable.from([bytes]),
    new AttachmentFrameEncryptStream(roomKey, { frameBytes: FRAME_BYTES, ...options }),
    new Writable({
      write (chunk, encoding, callback) {
        out.push(Buffer.from(chunk))
        callback()
      }
    })
  )
  return out
}

async function openFramed (parts, roomKey = ROOM_KEY) {
  const out = []
  await pipeline(
    Readable.from(parts),
    new AttachmentDecryptStream(roomKey),
    new Writable({
      write (chunk, encoding, callback) {
        out.push(Buffer.from(chunk))
        callback()
      }
    })
  )
  return Buffer.concat(out)
}

test('a framed attachment round-trips, and says so in its header', async () => {
  const plaintext = Buffer.alloc(1400, 5)
  const sealed = await sealFramed(plaintext)
  const blob = Buffer.concat(sealed)

  assert.equal(blob.subarray(0, 4).toString(), 'PCA2')
  assert.equal(blob.byteLength, framedSealedLength(plaintext.byteLength, FRAME_BYTES))
  assert.equal(blob.includes(plaintext.subarray(0, 64)), false)
  assert.deepEqual(await openFramed([blob]), plaintext)
})

test('the stored length matches what the writer actually produces', async () => {
  for (const size of [1, FRAME_BYTES - 1, FRAME_BYTES, FRAME_BYTES + 1, FRAME_BYTES * 3]) {
    const blob = Buffer.concat(await sealFramed(Buffer.alloc(size, 7)))
    assert.equal(blob.byteLength, framedSealedLength(size, FRAME_BYTES), `size ${size}`)
  }
})

// This is the whole point of framing: one frame in memory, not one file.
test('framing never hands over more than a frame at a time', async () => {
  const sealed = await sealFramed(Buffer.alloc(FRAME_BYTES * 20, 3), ROOM_KEY, {
    createCipher: createOneShotCipher
  })
  for (const part of sealed) assert.ok(part.byteLength <= FRAME_BYTES + 16)
})

test('a framed attachment is unreadable with another room key', async () => {
  const blob = Buffer.concat(await sealFramed(Buffer.alloc(900, 2)))
  await assert.rejects(openFramed([blob], OTHER_ROOM_KEY), /decryption failed/)
})

test('chopping off the end of a framed attachment is not a shorter file', async () => {
  const sealed = await sealFramed(Buffer.alloc(FRAME_BYTES * 3, 4))
  const blob = Buffer.concat(sealed)
  // Drop the last frame. Its frames are sealed under their own index with the
  // final one flagged, so the one before it cannot stand in as the end.
  const truncated = blob.subarray(0, blob.byteLength - 16)
  await assert.rejects(openFramed([truncated]), /decryption failed|incomplete/)
})

test('reordering frames does not decrypt', async () => {
  const header = 16
  const frame = FRAME_BYTES + 16
  const blob = Buffer.concat(await sealFramed(Buffer.alloc(FRAME_BYTES * 3, 6)))
  const swapped = Buffer.concat([
    blob.subarray(0, header),
    blob.subarray(header + frame, header + frame * 2),
    blob.subarray(header, header + frame),
    blob.subarray(header + frame * 2)
  ])
  await assert.rejects(openFramed([swapped]), /decryption failed/)
})

test('editing the header is caught by the frames', async () => {
  const blob = Buffer.from(Buffer.concat(await sealFramed(Buffer.alloc(900, 8))))
  blob[7] = blob[7] ^ 0x01
  await assert.rejects(openFramed([blob]), /decryption failed|header/)
})

test('a header split across chunks still reads', async () => {
  const plaintext = Buffer.alloc(1400, 9)
  const blob = Buffer.concat(await sealFramed(plaintext))
  const parts = [blob.subarray(0, 3), blob.subarray(3, 9), blob.subarray(9)]
  assert.deepEqual(await openFramed(parts), plaintext)
})

// What desktop PeerChat's sealAttachmentStream writes for this room key, these
// 8 bytes and 8-byte frames. test/attachment-crypto.test.js in PeerChat pins the
// same bytes, so a change that one side cannot read fails on the other.
test('a framed attachment is the same bytes desktop seals and opens', async () => {
  const plaintext = Buffer.from('PeerChat framed vector, both apps.')
  const desktop = '50434132000000080102030405060708abb77278dba950a24b40e33ad546e0c4b794b4a5f4bb4df4226050ae9ff032776d30f7886536c431dcf737ab0abf92be003fa9a2d9ee02261e82c92aba69147f3c1a22e82e71ccd292b2574c05061353633cec9ab230c51db8584f9a6ed3c7303ee8b93cee2e7ddde84c3e46b89cba6efbd8'
  const sealed = await sealFramed(plaintext, ROOM_KEY, {
    frameBytes: 8,
    baseNonce: Buffer.from('0102030405060708', 'hex')
  })
  assert.equal(Buffer.concat(sealed).toString('hex'), desktop)
  assert.deepEqual(await openFramed([Buffer.from(desktop, 'hex')]), plaintext)
})

test('everything desktop can already open is still sealed the old way', () => {
  assert.equal(sealedAttachmentLength(1024), singleSealedLength(1024))
  assert.equal(sealedAttachmentLength(MAX_SINGLE_SEAL_BYTES), singleSealedLength(MAX_SINGLE_SEAL_BYTES))
  assert.equal(
    sealedAttachmentLength(MAX_SINGLE_SEAL_BYTES + 1),
    framedSealedLength(MAX_SINGLE_SEAL_BYTES + 1)
  )
})

test('a framed attachment uploads and opens through the drive', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'peersky-peerchat-framed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pickerDirectory = path.join(root, 'cache', 'imagepicker')
  await mkdir(pickerDirectory, { recursive: true })
  const sourcePath = path.join(pickerDirectory, 'film.mp4')
  const plaintext = Buffer.alloc(FRAME_BYTES * 9 + 77, 12)
  await writeFile(sourcePath, plaintext)

  const stored = new Map()
  const blockSizes = []
  const drive = {
    id: DRIVE_ID,
    createWriteStream (pathname) {
      const chunks = []
      return new Writable({
        write (chunk, encoding, callback) {
          blockSizes.push(chunk.byteLength)
          chunks.push(Buffer.from(chunk))
          callback()
        },
        final (callback) {
          stored.set(pathname, Buffer.concat(chunks))
          callback()
        }
      })
    },
    createReadStream (pathname) {
      return Readable.from([stored.get(pathname)])
    },
    async entry (pathname) {
      const bytes = stored.get(pathname)
      return bytes ? { value: { blob: { byteLength: bytes.byteLength } } } : null
    }
  }
  const runtime = { async getDrive () { return drive } }

  const uploaded = await uploadPeerChatAttachment({
    roomKey: ROOM_KEY,
    fileUri: pathToFileURL(sourcePath).toString(),
    byteLength: plaintext.byteLength
  }, { runtime, ...FRAMED })
  assert.equal(uploaded.ok, true, uploaded.error)
  assert.equal(stored.values().next().value.subarray(0, 4).toString(), 'PCA2')
  for (const size of blockSizes) assert.ok(size <= ATTACHMENT_BLOCK_BYTES)

  const opened = await openPeerChatAttachment({
    roomKey: ROOM_KEY,
    url: uploaded.item.url,
    fileName: 'film.mp4',
    fileSize: plaintext.byteLength,
    encrypted: true
  }, { runtime, storagePath: root })
  assert.equal(opened.ok, true)
  assert.deepEqual(await readFile(new URL(opened.localUri)), plaintext)
})

// Desktop has no cap and still seals in one piece, so it can send something
// this phone cannot open. Saying which is better than running out of memory.
test('a single-sealed attachment too big for a phone is refused with a reason', async () => {
  const fileSize = MAX_SINGLE_SEAL_BYTES + 1
  const runtime = {
    async getDrive () {
      return {
        async entry () {
          return { value: { blob: { byteLength: singleSealedLength(fileSize) } } }
        }
      }
    }
  }

  const refused = await openPeerChatAttachment({
    roomKey: ROOM_KEY,
    url: `hyper://${DRIVE_ID}/1-abc.bin`,
    fileName: 'film.mp4',
    fileSize,
    encrypted: true
  }, { runtime })

  assert.equal(refused.ok, false)
  assert.match(refused.error, /sent in one piece.*100 MB/)
})

// The frame size is in the file's own header, which has not been read yet, so
// this only rules out a size that no sealing could have produced. The exact
// length is checked again against the file that comes out of the stream.
test('a stored size that no sealing could produce is refused', async () => {
  const runtime = {
    async getDrive () {
      return {
        async entry () {
          // Neither 1400 + 32 nor a header plus whole tags.
          return { value: { blob: { byteLength: 1437 } } }
        }
      }
    }
  }

  const refused = await openPeerChatAttachment({
    roomKey: ROOM_KEY,
    url: `hyper://${DRIVE_ID}/2-abc.bin`,
    fileName: 'film.mp4',
    fileSize: 1400,
    encrypted: true
  }, { runtime })

  assert.equal(refused.ok, false)
  assert.match(refused.error, /does not match the message/)
})

// The wait on an upload used to be a flat three minutes, which was plenty for a
// photo and would have given up on every film.
test('the upload wait grows with the file', async () => {
  const limit = 2 * 1024 * 1024 * 1024
  const { UPLOAD_TIMEOUT_MS, getPeerChatUploadTimeout } =
    await import('../../app/peerchat/attachment-timeout.mjs')

  assert.equal(getPeerChatUploadTimeout(0), UPLOAD_TIMEOUT_MS)
  assert.equal(getPeerChatUploadTimeout(1024 * 1024), UPLOAD_TIMEOUT_MS + 300)
  assert.ok(getPeerChatUploadTimeout(500 * 1024 * 1024) > 5 * 60 * 1000)
  // Ten minutes of headroom for a 2 GB film, and it keeps growing past that.
  assert.ok(getPeerChatUploadTimeout(limit) > 10 * 60 * 1000)
  assert.ok(getPeerChatUploadTimeout(limit * 4) > getPeerChatUploadTimeout(limit) * 3)
})
