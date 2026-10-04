import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import b4a from 'b4a'
import Hyperdrive from 'hyperdrive'
import { create as createSDK } from 'hyper-sdk'
import { randomBytes } from 'hypercore-crypto'
import z32 from 'z32'

import { driveOpenId, shareDriveOpens } from '../../backend/hyper/shared-drive-opens.mjs'

const SWARM_OFF = { bootstrap: [], port: 0 }

test('one drive is named the same way by address, hostname, key or bytes', () => {
  const key = randomBytes(32)
  const hex = b4a.toString(key, 'hex')
  assert.equal(driveOpenId(`hyper://${z32.encode(key)}/`), hex)
  assert.equal(driveOpenId(`hyper://${hex}/app-icon.png`), hex)
  assert.equal(driveOpenId(z32.encode(key)), hex)
  assert.equal(driveOpenId(hex.toUpperCase()), hex)
  assert.equal(driveOpenId(key), hex)
  // A drive's name keeps its case, and a drive named like a domain is not the
  // drive that domain points to.
  assert.equal(driveOpenId('Notes'), 'name:Notes')
  assert.equal(driveOpenId('notes'), 'name:notes')
  assert.equal(driveOpenId('hyper://example.com/'), 'host:example.com')
  assert.equal(driveOpenId('example.com'), 'name:example.com')
  assert.equal(driveOpenId('https://example.com/'), null)
  assert.equal(driveOpenId(''), null)
})

// Three reads of a drive not opened yet, as a page's files arrive. Without this
// the second and third each opened the drive again, and waited for the first
// open to close, which it never does.
test('reads that arrive together share one open of a drive', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-opens-'))
  const sdks = []
  let stop = () => {}
  t.after(async () => {
    stop()
    await Promise.allSettled(sdks.map((sdk) => sdk.close()))
    await rm(root, { recursive: true, force: true })
  })

  const desktop = await createSDK({ storage: join(root, 'desktop'), swarmOpts: SWARM_OFF, autoJoin: false })
  const phone = shareDriveOpens(await createSDK({ storage: join(root, 'phone'), swarmOpts: SWARM_OFF, autoJoin: false }))
  sdks.push(desktop, phone)
  const left = desktop.corestore.replicate(true)
  const right = phone.corestore.replicate(false)
  left.pipe(right).pipe(left)
  stop = () => { left.destroy(); right.destroy() }

  const made = new Hyperdrive(desktop.corestore.namespace('site'))
  await made.ready()
  await made.put('/index.html', b4a.from('<h1>hello</h1>'))

  const address = `hyper://${z32.encode(made.key)}/`
  let timer = null
  const drives = await Promise.race([
    Promise.all([
      phone.getDrive(address),
      phone.getDrive(b4a.toString(made.key, 'hex')),
      phone.getDrive(address)
    ]),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5000) })
  ])
  clearTimeout(timer)
  assert.ok(drives, 'every read got its drive')
  assert.equal(drives[1], drives[0])
  assert.equal(drives[2], drives[0])
  assert.equal(await phone.getDrive(address), drives[0])
})

// Someone's private drive, read without its key. Its first block is here and
// does not decode, so opening it fails, and the drive that failed keeps its
// core: every later open of it used to wait forever.
test('a later open of a drive that did not decode fails at once, rather than never', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-opens-'))
  const sdks = []
  let stop = () => {}
  t.after(async () => {
    stop()
    await Promise.allSettled(sdks.map((sdk) => sdk.close()))
    await rm(root, { recursive: true, force: true })
  })

  const desktop = await createSDK({ storage: join(root, 'desktop'), swarmOpts: SWARM_OFF, autoJoin: false })
  const phone = shareDriveOpens(await createSDK({ storage: join(root, 'phone'), swarmOpts: SWARM_OFF, autoJoin: false }))
  sdks.push(desktop, phone)
  const left = desktop.corestore.replicate(true)
  const right = phone.corestore.replicate(false)
  left.pipe(right).pipe(left)
  stop = () => { left.destroy(); right.destroy() }

  const made = new Hyperdrive(desktop.corestore.namespace('private'), null, { encryptionKey: randomBytes(32) })
  await made.ready()
  await made.put('/app-icon.png', b4a.from('picture bytes'))
  // Held open, so the block it fetched is the one the drive opens with.
  const core = phone.corestore.get({ key: made.key })
  await core.get(0, { timeout: 5000 })

  const address = `hyper://${z32.encode(made.key)}/`
  const open = () => Promise.race([
    phone.getDrive(address).then(() => 'opened', (error) => error.code),
    new Promise((resolve) => setTimeout(() => resolve('waited'), 3000))
  ])
  assert.equal(await open(), 'DECODING_ERROR')
  assert.equal(await open(), 'DECODING_ERROR')
})

test('every store the phone opens shares its drive opens', async () => {
  const runtime = await readFile(new URL('../../backend/hyper/runtime.mjs', import.meta.url), 'utf8')
  const created = runtime.match(/createSDK\(/g) || []
  const shared = runtime.match(/createSDK\([\s\S]*?\)\s*\.then\(shareDriveOpens\)/g) || []
  assert.equal(created.length, 4)
  assert.equal(shared.length, created.length)
})
