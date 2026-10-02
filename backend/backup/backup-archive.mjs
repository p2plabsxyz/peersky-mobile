import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import b4a from 'b4a'

// The encrypted payload is a run of records, each a JSON header and then, for
// a file, its bytes:
//
//   [u32 header length][header JSON][file bytes]
//
// Headers are { type: 'about' }, { type: 'dir', name }, { type: 'file', name,
// size } and a closing { type: 'end' }. The size in the header lets a file
// stream straight to disk, and the end record catches a payload that stops
// early even when every frame before it authenticated.
const MAX_HEADER_BYTES = 16 * 1024
const READ_CHUNK_BYTES = 256 * 1024
const ENTRY_TYPES = new Set(['about', 'dir', 'file', 'end'])

export function createArchiveWriter (sink) {
  let ended = false
  let fileBytes = 0

  async function writeHeader (header) {
    if (ended) throw new Error('Archive is already closed')
    const json = b4a.from(JSON.stringify(header))
    if (json.byteLength > MAX_HEADER_BYTES) throw new Error(`Archive entry name is too long: ${header.name}`)
    const prefix = b4a.alloc(4)
    prefix.writeUInt32LE(json.byteLength, 0)
    await sink(prefix)
    await sink(json)
  }

  return {
    get fileBytes () { return fileBytes },

    async addAbout (about) {
      await writeHeader({ ...about, type: 'about' })
    },

    async addDirectory (name) {
      await writeHeader({ type: 'dir', name })
    },

    async addBytes (name, bytes) {
      await writeHeader({ type: 'file', name, size: bytes.byteLength })
      if (bytes.byteLength > 0) await sink(bytes)
      fileBytes += bytes.byteLength
    },

    // The size is taken from the open file, and exactly that many bytes are
    // written, so the archive never goes out of step with its own headers. A
    // file replaced by a rename while packing is read whole, old or new. One
    // that is gone by the time it is reached is left out: returns false.
    async addFile (name, filePath) {
      let fd
      try {
        fd = openSync(filePath, 'r')
      } catch (error) {
        if (error.code === 'ENOENT') return false
        throw error
      }
      try {
        const size = fstatSync(fd).size
        await writeHeader({ type: 'file', name, size })
        let offset = 0
        while (offset < size) {
          const buffer = b4a.alloc(Math.min(READ_CHUNK_BYTES, size - offset))
          const read = readSync(fd, buffer, 0, buffer.byteLength, offset)
          if (read === 0) throw new Error(`${name} changed while it was being backed up`)
          await sink(read === buffer.byteLength ? buffer : buffer.subarray(0, read))
          offset += read
        }
        fileBytes += size
        return true
      } finally {
        closeSync(fd)
      }
    },

    async end () {
      await writeHeader({ type: 'end' })
      ended = true
    }
  }
}

/**
 * Parses records out of decrypted payload chunks as they arrive. The callbacks
 * do the writing, so nothing larger than one chunk is ever held here.
 */
export function createArchiveReader ({ onAbout, onDirectory, onFileStart, onFileData, onFileEnd } = {}) {
  let buffered = b4a.alloc(0)
  let state = 'length'
  let needed = 4
  let remaining = 0
  let ended = false
  let entries = 0
  let currentName = ''

  async function handleHeader (bytes) {
    let header
    try {
      header = JSON.parse(b4a.toString(bytes, 'utf8'))
    } catch {
      throw new Error('Backup archive is damaged')
    }
    if (!header || typeof header !== 'object' || !ENTRY_TYPES.has(header.type)) {
      throw new Error('Backup archive is damaged')
    }

    entries += 1
    if (header.type === 'end') {
      ended = true
      return
    }
    if (header.type === 'about') {
      if (onAbout) await onAbout(header)
      return
    }
    if (typeof header.name !== 'string' || !header.name) throw new Error('Backup archive is damaged')
    if (header.type === 'dir') {
      if (onDirectory) await onDirectory(header.name)
      return
    }

    if (!Number.isSafeInteger(header.size) || header.size < 0) throw new Error('Backup archive is damaged')
    if (onFileStart) await onFileStart(header.name, header.size)
    remaining = header.size
    if (remaining === 0) {
      if (onFileEnd) await onFileEnd(header.name)
      return
    }
    state = 'data'
    currentName = header.name
  }

  return {
    get ended () { return ended },
    get entries () { return entries },

    async push (chunk) {
      let offset = 0
      while (offset < chunk.byteLength) {
        if (ended) throw new Error('Backup archive has data after its end')

        if (state === 'data') {
          const take = Math.min(remaining, chunk.byteLength - offset)
          if (onFileData) await onFileData(chunk.subarray(offset, offset + take))
          remaining -= take
          offset += take
          if (remaining === 0) {
            state = 'length'
            needed = 4
            if (onFileEnd) await onFileEnd(currentName)
          }
          continue
        }

        const take = Math.min(needed - buffered.byteLength, chunk.byteLength - offset)
        buffered = b4a.concat([buffered, chunk.subarray(offset, offset + take)])
        offset += take
        if (buffered.byteLength < needed) continue

        const complete = buffered
        buffered = b4a.alloc(0)
        if (state === 'length') {
          const length = complete.readUInt32LE(0)
          if (length < 2 || length > MAX_HEADER_BYTES) throw new Error('Backup archive is damaged')
          state = 'header'
          needed = length
        } else {
          state = 'length'
          needed = 4
          await handleHeader(complete)
        }
      }
    },

    finish () {
      if (!ended || state !== 'length' || buffered.byteLength > 0) {
        throw new Error('Backup file is incomplete. It was cut off before the end.')
      }
    }
  }
}
