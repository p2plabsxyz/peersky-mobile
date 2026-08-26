import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  listHyperdriveLocation,
  uploadHyperdriveFile
} from '../../backend/hyper/library.mjs'

const DRIVE_URL = `hyper://${'a'.repeat(64)}/`

test('lists only immediate directory children and folders first', async () => {
  const drive = createDrive({
    '/cover.png': { blob: { byteLength: 12 } },
    '/docs/readme.md': { blob: { byteLength: 24 } },
    '/docs/nested/guide.md': { blob: { byteLength: 48 } }
  })

  const response = await listHyperdriveLocation({ url: DRIVE_URL }, {
    runtime: { getDrive: async () => drive }
  })

  assert.equal(response.ok, true)
  assert.deepEqual(response.items.map(({ type, name }) => ({ type, name })), [
    { type: 'directory', name: 'docs' },
    { type: 'file', name: 'cover.png' }
  ])
})

test('returns a fetched file with bounded metadata', async () => {
  const drive = createDrive({ '/manual.pdf': { blob: { byteLength: 128 } } })
  const response = await listHyperdriveLocation({ url: `${DRIVE_URL}manual.pdf` }, {
    runtime: { getDrive: async () => drive }
  })

  assert.deepEqual(response.location, {
    type: 'file',
    name: 'manual.pdf',
    path: '/manual.pdf',
    url: `${DRIVE_URL}manual.pdf`,
    byteLength: 128
  })
})

test('rejects a missing non-root path instead of displaying an empty folder', async () => {
  const drive = createDrive({})
  const response = await listHyperdriveLocation({ url: `${DRIVE_URL}missing/` }, {
    runtime: { getDrive: async () => drive }
  })

  assert.deepEqual(response, {
    ok: false,
    error: 'No file or directory was found at this Hyper URL.'
  })
})

test('uploads with a safe unique filename', async () => {
  const drive = createDrive({ '/report.pdf': { blob: { byteLength: 1 } } })
  const response = await uploadHyperdriveFile({
    name: '../report.pdf',
    contentBase64: Buffer.from('new report').toString('base64')
  }, {
    runtime: { getDrive: async () => drive }
  })

  assert.equal(response.ok, true)
  assert.equal(response.item.name, 'report (1).pdf')
  assert.equal(drive.writes[0].path, '/report (1).pdf')
})

test('sanitizes URL delimiters and encodes uploaded file URLs', async () => {
  const drive = createDrive({})
  const response = await uploadHyperdriveFile({
    name: 'report #2?.pdf',
    contentBase64: Buffer.from('report').toString('base64')
  }, {
    runtime: { getDrive: async () => drive }
  })

  assert.equal(response.ok, true)
  assert.equal(drive.writes[0].path, '/report -2-.pdf')
  assert.equal(response.item.url, `${DRIVE_URL}report%20-2-.pdf`)
})

test('serializes simultaneous uploads before selecting duplicate names', async () => {
  const drive = createDrive({})
  const runtime = { getDrive: async () => drive }
  const upload = () => uploadHyperdriveFile({
    name: 'photo.jpg',
    contentBase64: Buffer.from('photo').toString('base64')
  }, { runtime })

  const [first, second] = await Promise.all([upload(), upload()])
  assert.equal(first.item.name, 'photo.jpg')
  assert.equal(second.item.name, 'photo (1).jpg')
})

test('rejects invalid and oversized uploads before opening the runtime', async () => {
  let opened = false
  const runtime = { getDrive: async () => { opened = true } }

  assert.equal((await uploadHyperdriveFile({ name: '..', contentBase64: 'YQ==' }, { runtime })).ok, false)
  assert.equal((await uploadHyperdriveFile({
    name: 'large.bin',
    contentBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')
  }, { runtime })).ok, false)
  assert.equal(opened, false)
})

function createDrive (entries) {
  const writes = []
  return {
    id: 'a'.repeat(64),
    writes,
    async entry (pathname) {
      const value = entries[pathname]
      return value ? { key: pathname, value } : null
    },
    async exists (pathname) {
      return Boolean(entries[pathname])
    },
    async put (pathname, bytes) {
      writes.push({ path: pathname, bytes })
      entries[pathname] = { blob: { byteLength: bytes.byteLength } }
    },
    async * list (prefix) {
      for (const [key, value] of Object.entries(entries)) {
        if (key.startsWith(prefix)) yield { key, value }
      }
    }
  }
}
