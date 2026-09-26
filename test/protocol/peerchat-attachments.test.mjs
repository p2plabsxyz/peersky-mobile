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
  MAX_ATTACHMENT_BYTES,
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
  return {
    update (chunk) {
      pending.push(Buffer.from(chunk))
      return Buffer.alloc(0)
    },
    final () {
      const cipher = createCipheriv(algorithm, key, iv)
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

test('a file past what a phone can seal is refused by name, not by crypto error', async () => {
  const refused = await uploadPeerChatAttachment({
    roomKey: ROOM_KEY,
    fileUri: 'file:///var/mobile/Library/Caches/imagepicker/huge.mov',
    byteLength: MAX_ATTACHMENT_BYTES + 1
  }, { runtime: { async getDrive () { throw new Error('should not reach the drive') } } })

  assert.equal(refused.ok, false)
  assert.equal(refused.error, 'PeerChat attachments must be 100 MB or smaller.')
})
