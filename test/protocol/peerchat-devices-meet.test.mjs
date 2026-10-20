// Two of one person's devices, linked, that share no room: both left P2P
// Republic, say, and the person linked them before joining anything. A room
// was the only place devices met, so these two never met, and a room made on
// one never reached the other. They meet now under a topic only the link's
// holders can work out, and prove the link on the connection. Desktop
// PeerChat does the same (test/devices-meet.test.js there).
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import HyperDHT from 'hyperdht'
import createTestnet from 'hyperdht/testnet.js'
import Hyperswarm from 'hyperswarm'

import { checkDevicesProof, devicesProof, devicesTopic } from '../../backend/peerchat/device-link.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'

const WAIT_MS = 20_000
const REPUBLIC = b4a.toString(derivePeerChatTopic(PRE_JOINED_PEERCHAT_ROOM_KEY), 'hex')
const LINK = { key: '5a'.repeat(32), origin: 'desktop', labels: ['mobile'] }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('where one person\'s devices meet', () => {
  // The desktop pins the same bytes (devices-meet.test.js in PeerChat).
  it('is the same topic and proof as on the desktop', () => {
    const link = { key: '0f'.repeat(32) }
    assert.equal(b4a.toString(devicesTopic(link), 'hex'), 'a6be18025b49b2dcaf36e91189ddf158d3b1c42529d20b746e53cda4f9187cff')
    const proof = devicesProof(link, '0e'.repeat(64), '0d'.repeat(32))
    assert.equal(proof, '53481f782190e3a7dedc59bbddbe1fd810913b36508c00159d2d03a80ef28589')
    assert.equal(checkDevicesProof(link, b4a.from('0e'.repeat(64), 'hex'), b4a.from('0d'.repeat(32), 'hex'), proof), true)
  })

  it('takes a proof only for this link, this connection and this sender', () => {
    const link = { key: '0f'.repeat(32) }
    const proof = devicesProof(link, '0e'.repeat(64), '0d'.repeat(32))
    assert.equal(checkDevicesProof(link, '0c'.repeat(64), '0d'.repeat(32), proof), false)
    assert.equal(checkDevicesProof(link, '0e'.repeat(64), '0b'.repeat(32), proof), false)
    assert.equal(checkDevicesProof({ key: '1f'.repeat(32) }, '0e'.repeat(64), '0d'.repeat(32), proof), false)
    assert.equal(checkDevicesProof(link, '0e'.repeat(64), '0d'.repeat(32), undefined), false)
    assert.equal(devicesTopic(null), null)
  })
})

class Feed extends EventEmitter {
  constructor (log) {
    super()
    this.log = log
  }

  get length () { return this.log.entries.length }
  get byteLength () { return 0 }
  async ready () {}
  async append (entry) {
    this.log.entries.push(structuredClone(entry))
    this.emit('append')
  }

  async get (index) { return structuredClone(this.log.entries[index]) }
  async close () {}
}

describe('one person\'s devices with no room in common', () => {
  let testnet = null
  let root = ''
  const devices = []

  function makeDevice (letter, state) {
    const keyPair = crypto.keyPair()
    const device = { letter, keyPair, storagePath: path.join(root, letter), logs: new Map() }
    mkdirSync(device.storagePath, { recursive: true })
    writeFileSync(path.join(device.storagePath, 'peerchat-mobile.json'), JSON.stringify({
      version: 1,
      // Both left P2P Republic, so nothing else brings them together.
      leftRooms: { [PRE_JOINED_PEERCHAT_ROOM_KEY]: Date.now() },
      ...state
    }))
    devices.push(device)
    return device
  }

  async function start (device) {
    const dht = new HyperDHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1', ephemeral: true })
    const swarm = new Hyperswarm({ keyPair: device.keyPair, dht })
    const feeds = new Map()
    const sdk = {
      publicKey: device.keyPair.publicKey,
      swarm,
      corestore: {
        get: ({ name }) => {
          if (!device.logs.has(name)) device.logs.set(name, { entries: [] })
          if (!feeds.has(name)) feeds.set(name, new Feed(device.logs.get(name)))
          return feeds.get(name)
        },
        createKeyPair: async (name) => (name === 'noise' ? device.keyPair : crypto.keyPair())
      },
      join: (topic, opts) => {
        if (b4a.toString(topic, 'hex') === REPUBLIC) throw new Error('P2P Republic is off limits here')
        return swarm.join(topic, opts)
      },
      leave: (topic) => swarm.leave(topic)
    }
    Object.assign(device, { dht, swarm })
    device.service = await new PeerChatService({ sdk, storagePath: device.storagePath }).start()
  }

  async function waitFor (check, what) {
    const until = Date.now() + WAIT_MS
    while (!(await check())) {
      if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`)
      await sleep(50)
    }
  }

  const roomNames = (device) => device.service.listRooms().map((room) => room.name).sort()

  let phone, desktop, stranger

  before(async () => {
    testnet = await createTestnet(3, { host: '127.0.0.1' })
    root = mkdtempSync(path.join(tmpdir(), 'peerchat-devices-meet-'))
    desktop = makeDevice('a', { profile: { username: 'ada' }, device: { label: '' }, link: LINK })
    phone = makeDevice('b', { profile: { username: 'ada' }, device: { label: 'mobile' }, link: LINK })
    stranger = makeDevice('c', { profile: { username: 'cy' }, device: { label: '' }, link: { key: '6b'.repeat(32), origin: 'desktop', labels: [] } })
    // One after another, as devices start. Started at the same instant, each
    // looks the topic up before the other has announced it.
    for (const device of devices) {
      await start(device)
      await device.swarm.flush()
    }
  })

  after(async () => {
    for (const device of devices) {
      await device.service?.close().catch(() => {})
      await device.swarm?.destroy().catch(() => {})
      await device.dht?.destroy().catch(() => {})
    }
    await testnet?.destroy()
    rmSync(root, { recursive: true, force: true })
  })

  it('a room made on one reaches the other, and nobody else', async () => {
    assert.deepEqual(roomNames(phone), [])
    await desktop.service.createRoom({ name: 'Trip planning' })
    await waitFor(() => roomNames(phone).includes('Trip planning'), 'the room on the phone')
    await sleep(500)
    assert.deepEqual(roomNames(stranger), [])
  })

  it('a room made on the phone goes back the same way', async () => {
    await phone.service.createRoom({ name: 'Recipes' })
    await waitFor(() => roomNames(desktop).includes('Recipes'), 'the room back on the other device')
    assert.deepEqual(roomNames(stranger), [])
  })
})
