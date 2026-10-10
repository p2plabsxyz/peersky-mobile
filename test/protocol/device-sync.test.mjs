import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { create as createSDK } from 'hyper-sdk'
import createTestnet from 'hyperdht/testnet.js'
import Hyperdrive from 'hyperdrive'
import { attachDeviceSync, listDriveTop } from '../../backend/hyper/device-sync.mjs'
import { deviceSyncTopic } from '../../backend/hyper/device-sync-protocol.mjs'
import { readDeviceSyncState, resetDeviceSyncStateCache } from '../../backend/hyper/device-sync-state.mjs'

const hex = (buffer) => Buffer.from(buffer).toString('hex')

async function until (check, { timeout = 20000, every = 100, what = 'condition' } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, every))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function makeDevice (root, name, testnet, key) {
  const sdk = await createSDK({
    storage: join(root, name),
    swarmOpts: { bootstrap: testnet.bootstrap },
    autoJoin: false,
    doReplicate: true
  })
  const drive = new Hyperdrive(sdk.corestore.namespace('own-private'), null, { encryptionKey: key })
  await drive.ready()
  const opened = new Map()
  return {
    name,
    sdk,
    drive,
    id: hex(drive.key),
    stateDirectory: join(root, `${name}-state`),
    opened,
    async openDrive (id, driveKey) {
      if (!opened.has(id)) {
        opened.set(id, (async () => {
          const linked = new Hyperdrive(sdk.corestore.namespace(`linked-${id}`), Buffer.from(id, 'hex'), { encryptionKey: driveKey })
          await linked.ready()
          return linked
        })())
      }
      return opened.get(id)
    }
  }
}

function listing (device, driveId) {
  resetDeviceSyncStateCache()
  return readDeviceSyncState(device.stateDirectory).listings[driveId]?.items || []
}

function devicesSeenBy (device) {
  resetDeviceSyncStateCache()
  return readDeviceSyncState(device.stateDirectory).devices
}

test('a phone and a desktop with one private key find each other and keep each other\'s private files in view', { timeout: 120000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-device-sync-'))
  const testnet = await createTestnet(3)
  const key = randomBytes(32)
  const closers = []
  t.after(async () => {
    for (const close of closers.reverse()) await close().catch(() => {})
    await testnet.destroy()
    await rm(root, { recursive: true, force: true })
  })

  const phone = await makeDevice(root, 'phone', testnet, key)
  closers.push(() => phone.sdk.close())
  const desktop = await makeDevice(root, 'desktop', testnet, key)
  closers.push(() => desktop.sdk.close())

  await phone.drive.put('/hello.txt', Buffer.from('from the phone'))
  await desktop.drive.put('/report.pdf', Buffer.from('from the desktop'))

  let phoneMetered = false
  let phoneChanges = 0
  const phoneSync = attachDeviceSync(phone.sdk, {
    identityKey: key,
    stateDirectory: phone.stateDirectory,
    device: 'phone',
    ownDrives: () => [{ id: phone.id }],
    openDrive: (id, driveKey) => phone.openDrive(id, driveKey),
    isMetered: () => phoneMetered,
    onChange: () => { phoneChanges++ },
    logger: { warn () {} }
  })
  closers.push(() => phoneSync.close())
  // Announced before the desktop looks, as when one device was already on.
  await phoneSync.flushed()
  const desktopSync = attachDeviceSync(desktop.sdk, {
    identityKey: key,
    stateDirectory: desktop.stateDirectory,
    device: 'desktop',
    ownDrives: () => [{ id: desktop.id }],
    openDrive: (id, driveKey) => desktop.openDrive(id, driveKey),
    mirror: true,
    logger: { warn () {} }
  })
  closers.push(() => desktopSync.close())

  // Each lists the other, by what it is.
  const [seenByPhone] = await until(() => devicesSeenBy(phone).length ? devicesSeenBy(phone) : null, { what: 'the phone to meet the desktop' })
  assert.equal(seenByPhone.type, 'desktop')
  assert.equal(seenByPhone.id, hex(desktop.sdk.swarm.keyPair.publicKey))
  assert.deepEqual(seenByPhone.drives, [desktop.id])
  const [seenByDesktop] = await until(() => devicesSeenBy(desktop).length ? devicesSeenBy(desktop) : null, { what: 'the desktop to meet the phone' })
  assert.equal(seenByDesktop.type, 'phone')
  assert.deepEqual(seenByDesktop.drives, [phone.id])
  assert.equal(phoneSync.online.has(seenByPhone.id), true)
  assert.ok(phoneChanges > 0)

  // What is in the other's private drive, without opening anything by hand.
  await until(() => listing(phone, desktop.id).some((item) => item.name === 'report.pdf'), { what: 'the desktop file on the phone' })
  await until(() => listing(desktop, phone.id).some((item) => item.name === 'hello.txt'), { what: 'the phone file on the desktop' })
  assert.deepEqual(listing(desktop, phone.id)[0], { type: 'file', name: 'hello.txt', path: '/hello.txt', byteLength: 14 })

  // A new private upload shows up on its own, newest first.
  const photo = randomBytes(64 * 1024)
  await phone.drive.put('/photo.jpg', photo)
  await until(() => listing(desktop, phone.id)[0]?.name === 'photo.jpg', { what: 'a new phone upload on the desktop' })

  // The desktop keeps a copy of the phone's files, to open with the phone gone.
  const copyOnDesktop = await desktop.opened.get(phone.id)
  await until(async () => {
    const bytes = await copyOnDesktop.get('/photo.jpg', { wait: false }).catch(() => null)
    return bytes && Buffer.compare(bytes, photo) === 0
  }, { what: 'the desktop to copy the photo' })

  // The phone lists the desktop's files but fetches them only when opened.
  const desktopDriveOnPhone = await phone.opened.get(desktop.id)
  assert.equal(await desktopDriveOnPhone.has('/report.pdf'), false)
  assert.equal((await desktopDriveOnPhone.get('/report.pdf')).toString(), 'from the desktop')

  // On a cellular connection the phone's files are listed but not pulled...
  phoneMetered = true
  phoneSync.announce()
  await new Promise((resolve) => setTimeout(resolve, 500))
  const video = randomBytes(256 * 1024)
  await phone.drive.put('/video.mp4', video)
  await until(() => listing(desktop, phone.id).some((item) => item.name === 'video.mp4'), { what: 'the video in the list' })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal(await copyOnDesktop.has('/video.mp4'), false)

  // ...until it is back on Wi-Fi.
  phoneMetered = false
  phoneSync.announce()
  await until(async () => {
    const bytes = await copyOnDesktop.get('/video.mp4', { wait: false }).catch(() => null)
    return bytes && Buffer.compare(bytes, video) === 0
  }, { what: 'the desktop to copy the video on Wi-Fi' })

  // The phone going away leaves the desktop listed as seen.
  const lastSeenBefore = devicesSeenBy(desktop)[0].lastSeen
  await phoneSync.close()
  await phone.sdk.close()
  await until(() => !desktopSync.online.has(seenByDesktop.id), { what: 'the desktop to see the phone go' })
  assert.ok(devicesSeenBy(desktop)[0].lastSeen >= lastSeenBefore)
  // And its files stay listed, and stay readable from the copy.
  assert.ok(listing(desktop, phone.id).some((item) => item.name === 'photo.jpg'))
  assert.equal(Buffer.compare(await copyOnDesktop.get('/photo.jpg', { wait: false }), photo), 0)
})

test('a device that finds the topic without the key learns nothing and is not listed', { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-device-sync-stranger-'))
  const testnet = await createTestnet(3)
  const key = randomBytes(32)
  const closers = []
  t.after(async () => {
    for (const close of closers.reverse()) await close().catch(() => {})
    await testnet.destroy()
    await rm(root, { recursive: true, force: true })
  })

  const phone = await makeDevice(root, 'phone', testnet, key)
  closers.push(() => phone.sdk.close())
  const stranger = await makeDevice(root, 'stranger', testnet, randomBytes(32))
  closers.push(() => stranger.sdk.close())

  const phoneSync = attachDeviceSync(phone.sdk, {
    identityKey: key,
    stateDirectory: phone.stateDirectory,
    device: 'phone',
    ownDrives: () => [{ id: phone.id }],
    openDrive: (id, driveKey) => phone.openDrive(id, driveKey),
    logger: { warn () {} }
  })
  closers.push(() => phoneSync.close())
  await phoneSync.flushed()

  // It joins the topic, say because a DHT node saw it, and speaks the
  // protocol, but with another key.
  stranger.sdk.join(deviceSyncTopic(key), { server: true, client: true })
  const strangerSync = attachDeviceSync(stranger.sdk, {
    identityKey: randomBytes(32),
    stateDirectory: stranger.stateDirectory,
    device: 'desktop',
    ownDrives: () => [{ id: stranger.id }],
    openDrive: (id, driveKey) => stranger.openDrive(id, driveKey),
    logger: { warn () {} }
  })
  closers.push(() => strangerSync.close())

  await until(() => phone.sdk.swarm.connections.size > 0, { what: 'the stranger to connect' })
  await new Promise((resolve) => setTimeout(resolve, 3000))

  assert.deepEqual(devicesSeenBy(phone), [])
  assert.deepEqual(devicesSeenBy(stranger), [])
  assert.equal(phone.opened.size, 0)
  assert.equal(stranger.opened.size, 0)
  assert.equal(phoneSync.online.size, 0)
})

test('the top of a drive lists newest first and stops at its limits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-device-sync-list-'))
  const sdk = await createSDK({ storage: root, swarmOpts: { bootstrap: [], port: 0 }, autoJoin: false, doReplicate: false })
  t.after(async () => {
    await sdk.close()
    await rm(root, { recursive: true, force: true })
  })
  const drive = new Hyperdrive(sdk.corestore.namespace('list'))
  await drive.ready()
  await drive.put('/b.txt', Buffer.from('bb'))
  await drive.put('/Photos/one.jpg', Buffer.from('1'))
  await drive.put('/Photos/two.jpg', Buffer.from('2'))
  await drive.put('/a.txt', Buffer.from('a'))
  await drive.symlink('/link', '/a.txt')

  const { items, truncated } = await listDriveTop(drive)
  assert.equal(truncated, false)
  assert.deepEqual(items, [
    { type: 'file', name: 'a.txt', path: '/a.txt', byteLength: 1 },
    { type: 'directory', name: 'Photos', path: '/Photos/', byteLength: 0 },
    { type: 'file', name: 'b.txt', path: '/b.txt', byteLength: 2 }
  ])

  const limited = await listDriveTop(drive, { maxItems: 2 })
  assert.equal(limited.items.length, 2)
  assert.equal(limited.truncated, true)
})

test('two devices that join at the same moment still find each other', { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-device-sync-race-'))
  const testnet = await createTestnet(3)
  const key = randomBytes(32)
  const closers = []
  t.after(async () => {
    for (const close of closers.reverse()) await close().catch(() => {})
    await testnet.destroy()
    await rm(root, { recursive: true, force: true })
  })

  const phone = await makeDevice(root, 'phone', testnet, key)
  closers.push(() => phone.sdk.close())
  const desktop = await makeDevice(root, 'desktop', testnet, key)
  closers.push(() => desktop.sdk.close())

  // Neither waits for the other to announce: each looks before the other is
  // there, and only the second look finds it.
  for (const [device, type] of [[phone, 'phone'], [desktop, 'desktop']]) {
    const sync = attachDeviceSync(device.sdk, {
      identityKey: key,
      stateDirectory: device.stateDirectory,
      device: type,
      ownDrives: () => [{ id: device.id }],
      openDrive: (id, driveKey) => device.openDrive(id, driveKey),
      lookAgainMs: [1000, 3000],
      logger: { warn () {} }
    })
    closers.push(() => sync.close())
  }

  await until(() => devicesSeenBy(phone).length === 1 && devicesSeenBy(desktop).length === 1, { timeout: 30000, what: 'the two to meet' })
})

test('a connected device\'s last seen moves on while it stays, and once more as the sync closes', { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-device-sync-seen-'))
  const testnet = await createTestnet(3)
  const key = randomBytes(32)
  const closers = []
  t.after(async () => {
    for (const close of closers.reverse()) await close().catch(() => {})
    await testnet.destroy()
    await rm(root, { recursive: true, force: true })
  })

  const phone = await makeDevice(root, 'phone', testnet, key)
  closers.push(() => phone.sdk.close())
  const desktop = await makeDevice(root, 'desktop', testnet, key)
  closers.push(() => desktop.sdk.close())
  const syncs = {}
  for (const [device, type] of [[phone, 'phone'], [desktop, 'desktop']]) {
    syncs[type] = attachDeviceSync(device.sdk, {
      identityKey: key,
      stateDirectory: device.stateDirectory,
      device: type,
      ownDrives: () => [{ id: device.id }],
      openDrive: (id, driveKey) => device.openDrive(id, driveKey),
      seenEveryMs: 300,
      logger: { warn () {} }
    })
    closers.push(() => syncs[type].close())
    if (type === 'phone') await syncs.phone.flushed()
  }

  const [met] = await until(() => devicesSeenBy(phone).length ? devicesSeenBy(phone) : null, { what: 'the two to meet' })
  const later = await until(() => {
    const [device] = devicesSeenBy(phone)
    return device && device.lastSeen > met.lastSeen ? device : null
  }, { what: 'last seen to move on' })
  assert.equal(syncs.phone.online.has(met.id), true)

  await new Promise((resolve) => setTimeout(resolve, 50))
  const before = devicesSeenBy(phone)[0].lastSeen
  await syncs.phone.close()
  assert.ok(devicesSeenBy(phone)[0].lastSeen >= Math.max(before, later.lastSeen))
})

test('it looks for the other devices only while none is connected', { timeout: 60000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'peersky-device-sync-looks-'))
  const testnet = await createTestnet(3)
  const key = randomBytes(32)
  const closers = []
  t.after(async () => {
    for (const close of closers.reverse()) await close().catch(() => {})
    await testnet.destroy()
    await rm(root, { recursive: true, force: true })
  })

  const phone = await makeDevice(root, 'phone', testnet, key)
  closers.push(() => phone.sdk.close())
  const desktop = await makeDevice(root, 'desktop', testnet, key)
  closers.push(() => desktop.sdk.close())

  // Every look the phone makes, counted where the swarm is asked.
  let looks = 0
  const joinTopic = phone.sdk.join.bind(phone.sdk)
  phone.sdk.join = (topic, options) => {
    const discovery = joinTopic(topic, options)
    const refresh = discovery.refresh.bind(discovery)
    discovery.refresh = (...args) => {
      looks++
      return refresh(...args)
    }
    return discovery
  }

  const phoneSync = attachDeviceSync(phone.sdk, {
    identityKey: key,
    stateDirectory: phone.stateDirectory,
    device: 'phone',
    ownDrives: () => [{ id: phone.id }],
    openDrive: (id, driveKey) => phone.openDrive(id, driveKey),
    lookAgainMs: [],
    logger: { warn () {} }
  })
  closers.push(() => phoneSync.close())

  // Alone: a network change, a new file and news with nobody to tell all look.
  phoneSync.refresh()
  phoneSync.nudge()
  phoneSync.announce()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(looks, 3)

  await phoneSync.flushed()
  const desktopSync = attachDeviceSync(desktop.sdk, {
    identityKey: key,
    stateDirectory: desktop.stateDirectory,
    device: 'desktop',
    ownDrives: () => [{ id: desktop.id }],
    openDrive: (id, driveKey) => desktop.openDrive(id, driveKey),
    logger: { warn () {} }
  })
  closers.push(() => desktopSync.close())
  await until(() => phoneSync.online.size === 1, { what: 'the two to meet' })

  // Connected: none of them opens another connection.
  const before = looks
  phoneSync.refresh()
  phoneSync.nudge()
  phoneSync.announce()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(looks, before)
})
