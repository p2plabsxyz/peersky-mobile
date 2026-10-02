import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_BACKUP_SIZE_BYTES } from '../../backend/backup/limits.mjs'
import { openZipFile } from '../../backend/backup/zip-file.mjs'
import { writeHyperResponseToFile } from '../../backend/hyper/binary-response.mjs'

function createZipWithDeclaredSizes (sizes) {
  const centralEntries = sizes.map((size, index) => {
    const name = Buffer.from(`entry-${index}`)
    const entry = Buffer.alloc(46 + name.length)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt32LE(size, 24)
    entry.writeUInt16LE(name.length, 28)
    name.copy(entry, 46)
    return entry
  })
  const centralDirectory = Buffer.concat(centralEntries)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(sizes.length, 8)
  endOfCentralDirectory.writeUInt16LE(sizes.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)

  return Buffer.concat([centralDirectory, endOfCentralDirectory])
}

function createResponse (body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'hyper://example/backup.zip',
    body
  }
}

// The archive goes to disk first, the way a transfer does, and is read from
// there.
function openZipBytes (t, bytes) {
  const directory = mkdtempSync(join(tmpdir(), 'peersky-zip-limits-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'archive.zip')
  writeFileSync(filePath, bytes)
  return openZipFile(filePath)
}

function tempFile (t) {
  const directory = mkdtempSync(join(tmpdir(), 'peersky-response-limits-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return join(directory, 'download')
}

describe('backup input size limits', () => {
  it('rejects an oversized ZIP entry before inflation', (t) => {
    assert.throws(
      () => openZipBytes(t, createZipWithDeclaredSizes([MAX_BACKUP_SIZE_BYTES + 1])),
      /ZIP entry exceeds 2GB limit/
    )
  })

  it('rejects ZIP entries whose declared total exceeds 2GB', (t) => {
    const halfLimit = Math.floor(MAX_BACKUP_SIZE_BYTES / 2)
    assert.throws(
      () => openZipBytes(t, createZipWithDeclaredSizes([halfLimit, halfLimit + 1])),
      /ZIP contents exceed 2GB limit/
    )
  })

  it('rejects an oversized content-length before reading the response', async (t) => {
    let bodyRead = false
    const response = createResponse(null)
    response.arrayBuffer = async () => {
      bodyRead = true
      return new ArrayBuffer(0)
    }

    await assert.rejects(
      writeHyperResponseToFile(
        response,
        { 'content-length': String(MAX_BACKUP_SIZE_BYTES + 1) },
        response.url,
        tempFile(t)
      ),
      /Response exceeds 2GB limit/
    )
    assert.equal(bodyRead, false)
  })

  it('stops a reader stream when accumulated bytes exceed the limit', async (t) => {
    const chunks = [new Uint8Array(4), new Uint8Array(4)]
    let cancelled = false
    const reader = {
      async read () {
        return chunks.length > 0
          ? { done: false, value: chunks.shift() }
          : { done: true }
      },
      async cancel () {
        cancelled = true
      },
      releaseLock () {}
    }

    await assert.rejects(
      writeHyperResponseToFile(
        createResponse({ getReader: () => reader }),
        {},
        'hyper://example/backup.zip',
        tempFile(t),
        { maxBytes: 7 }
      ),
      /Response exceeds 7 byte limit/
    )
    assert.equal(cancelled, true)
  })

  it('limits async iterator and arrayBuffer response bodies', async (t) => {
    const iterableBody = {
      async * [Symbol.asyncIterator] () {
        yield new Uint8Array(4)
        yield new Uint8Array(4)
      }
    }

    await assert.rejects(
      writeHyperResponseToFile(createResponse(iterableBody), {}, '', tempFile(t), { maxBytes: 7 }),
      /Response exceeds 7 byte limit/
    )

    const response = createResponse(null)
    response.arrayBuffer = async () => new Uint8Array(8).buffer
    await assert.rejects(
      writeHyperResponseToFile(response, {}, '', tempFile(t), { maxBytes: 7 }),
      /Response exceeds 7 byte limit/
    )
  })
})
