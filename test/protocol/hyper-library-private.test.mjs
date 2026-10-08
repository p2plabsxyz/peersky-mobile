// A private link scanned in the Hyperdrive tab said "Decoding error: unknown
// wire type 7". It is another profile's drive, and says so now, after this
// phone's own private keys have been tried on it, as the browser already did.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import b4a from 'b4a'
import { create as createSDK } from 'hyper-sdk'
import z32 from 'z32'

import { listHyperdriveLocation } from '../../backend/hyper/library.mjs'
import { PRIVATE_DRIVE_ERROR } from '../../backend/hyper/linked-private-drives.mjs'
import { shareDriveOpens } from '../../backend/hyper/shared-drive-opens.mjs'

const DRIVE_URL = `hyper://${'b'.repeat(64)}/`
const undecodable = () => Object.assign(new Error('Decoding error: unknown wire type 7'), { code: 'DECODING_ERROR' })
const noArchive = async () => {}

test('a drive this phone cannot decode is said to be private', async () => {
  const asked = []
  const response = await listHyperdriveLocation({ url: `${DRIVE_URL}movie.mp4` }, {
    runtime: { getDrive: async () => { throw undecodable() } },
    opensAsPrivate: async (address) => { asked.push(address); return false },
    recordArchive: noArchive
  })
  assert.deepEqual(response, { ok: false, error: PRIVATE_DRIVE_ERROR })
  assert.equal(asked.length, 1)
})

test('one this phone\'s keys open is read again and listed', async () => {
  let opens = 0
  const drive = {
    id: 'b'.repeat(64),
    entry: async () => ({ value: { blob: { byteLength: 3 } } })
  }
  const response = await listHyperdriveLocation({ url: `${DRIVE_URL}movie.mp4` }, {
    runtime: {
      getDrive: async () => {
        opens++
        if (opens === 1) throw undecodable()
        return drive
      }
    },
    opensAsPrivate: async () => true,
    recordArchive: noArchive
  })
  assert.equal(response.ok, true)
  assert.equal(response.location.type, 'file')
  assert.equal(opens, 2)
})

test('still private when the second read cannot decode it either', async () => {
  const response = await listHyperdriveLocation({ url: DRIVE_URL }, {
    runtime: { getDrive: async () => { throw undecodable() } },
    opensAsPrivate: async () => true,
    recordArchive: noArchive
  })
  assert.deepEqual(response, { ok: false, error: PRIVATE_DRIVE_ERROR })
})

test('the error a real drive gives without its key is the one recognised', { timeout: 20_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-library-private-'))
  const sdks = []
  let stop = () => {}
  t.after(async () => {
    stop()
    await Promise.allSettled(sdks.map((sdk) => sdk.close()))
    await rm(root, { recursive: true, force: true })
  })
  const SWARM_OFF = { bootstrap: [], port: 0 }
  const desktop = await createSDK({ storage: join(root, 'desktop'), swarmOpts: SWARM_OFF, autoJoin: false })
  const phone = shareDriveOpens(await createSDK({ storage: join(root, 'phone'), swarmOpts: SWARM_OFF, autoJoin: false }))
  sdks.push(desktop, phone)
  const left = desktop.corestore.replicate(true)
  const right = phone.corestore.replicate(false)
  left.pipe(right).pipe(left)
  stop = () => { left.destroy(); right.destroy() }

  // A first block that is never a drive's header, as encrypted bytes read
  // without their key are not (random ones now and then decode after all).
  const made = desktop.corestore.get({ name: 'private-drive' })
  await made.ready()
  await made.append(b4a.from([0x07, 0x07]))
  const core = phone.corestore.get({ key: made.key })
  await core.update({ wait: true })
  await core.get(0, { timeout: 5000 })

  const response = await listHyperdriveLocation({ url: `hyper://${z32.encode(made.key)}/movie.mp4` }, {
    runtime: phone,
    opensAsPrivate: async () => false,
    recordArchive: noArchive
  })
  assert.deepEqual(response, { ok: false, error: PRIVATE_DRIVE_ERROR })
})
