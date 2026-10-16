import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'

import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { derivePeerChatTopic } from '../../backend/peerchat/protocol.mjs'
import { PRE_JOINED_PEERCHAT_ROOM_KEY } from '../../backend/peerchat/rooms.mjs'

// A thousand phones in one room, in one process, running the app's own
// PeerChat code. Only the network is left out: each connection is made in
// memory, both ends built as handleConnection builds them, and what one end
// sends goes to the other end's frame handler, as the transport would hand it
// over. So this tests how far messages, removals and moves get through a big
// room, and what each phone takes in, not sockets, the DHT or a phone's CPU.
// test/load/peerchat runs real connections, for hundreds.
//
//   npm run test:scale:peerchat
//   PEERCHAT_DEVICES=2000 PEERCHAT_LINKS=16 npm run test:scale:peerchat

const N = Number(process.env.PEERCHAT_DEVICES || 1000)
// How many others each phone connects to itself. Others connect to it too,
// so each ends up with about twice this, as Hyperswarm's 64 does in a big room.
const LINKS = Number(process.env.PEERCHAT_LINKS || 32)
const MESSAGES = Number(process.env.PEERCHAT_MESSAGES || 30)
const AFTER_MOVE = 10
const WAIT_MS = 180_000
const REPUBLIC = b4a.toString(derivePeerChatTopic(PRE_JOINED_PEERCHAT_ROOM_KEY), 'hex')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
let republicJoins = 0
let peakMB = 0
let peakHeapMB = 0
const noteMemory = () => {
  const { rss, heapUsed } = process.memoryUsage()
  peakMB = Math.max(peakMB, Math.round(rss / 1e6))
  peakHeapMB = Math.max(peakHeapMB, Math.round(heapUsed / 1e6))
}

// A room's log in memory: both apps only append to it and read it by index.
class Feed extends EventEmitter {
  constructor (phone) {
    super()
    this.phone = phone
    this.entries = []
    this.bytes = 0
  }

  get length () { return this.entries.length }
  get byteLength () { return this.bytes }
  async ready () {}

  async append (entry) {
    this.entries.push(entry)
    this.bytes += Buffer.byteLength(JSON.stringify(entry))
    noteEntry(this.phone, entry)
    this.emit('append')
  }

  async get (index) { return structuredClone(this.entries[index]) }
  async close () {}
}

// What each phone stored: chat messages by id, and the notices of a removal
// and of the room's new key.
function noteEntry (phone, entry) {
  if (!entry || typeof entry !== 'object') return
  if (entry.type === 'system') {
    const text = String(entry.text || entry.message || '')
    if (text.includes('was removed from the room')) phone.removalSeen = true
    if (text.includes('has a new key')) phone.moveSeen = true
    return
  }
  if (entry.type !== undefined && entry.type !== 'message') return
  if (typeof entry.id === 'string' && !phone.arrivals.has(entry.id)) phone.arrivals.set(entry.id, Date.now())
}

async function makePhone (idx, runDir) {
  const keyPair = crypto.keyPair()
  const phone = {
    idx,
    keyPair,
    key: b4a.toString(keyPair.publicKey, 'hex'),
    name: `Phone ${String(idx).padStart(4, '0')}`,
    feeds: new Map(),
    arrivals: new Map(),
    connections: 0,
    rx: 0,
    removalSeen: false,
    moveSeen: false
  }
  const storagePath = path.join(runDir, String(idx))
  mkdirSync(storagePath)
  const swarm = new EventEmitter()
  swarm.flush = async () => {}
  const sdk = {
    publicKey: keyPair.publicKey,
    swarm,
    localSwarm: new EventEmitter(),
    corestore: {
      get: ({ name }) => {
        if (!phone.feeds.has(name)) phone.feeds.set(name, new Feed(phone))
        return phone.feeds.get(name)
      },
      createKeyPair: async (name) => (name === 'noise' ? keyPair : crypto.keyPair())
    },
    // Never P2P Republic, though nothing here reaches the network anyway.
    join: (topic) => {
      if (b4a.toString(topic, 'hex') === REPUBLIC) {
        republicJoins++
        throw new Error('P2P Republic is off limits here')
      }
    },
    leave: async () => {}
  }
  phone.service = await new PeerChatService({ sdk, storagePath }).start()
  // A name and no onboarding, which is what joins P2P Republic.
  phone.service.setProfile({ username: phone.name })
  return phone
}

// One connection, both ends.
function connect (a, b) {
  const handshakeHash = crypto.randomBytes(64)
  const ends = [[a, b], [b, a]].map(([self, other]) => {
    const connection = {
      publicKey: self.keyPair.publicKey,
      remotePublicKey: other.keyPair.publicKey,
      handshakeHash,
      destroyed: false,
      on () {},
      destroy: () => close()
    }
    return { self, connection, peer: self.service.newPeer(connection) }
  })
  const close = () => {
    for (const end of ends) {
      if (end.connection.destroyed) continue
      end.connection.destroyed = true
      end.self.service.deactivatePeer(end.peer)
    }
  }
  for (const [from, to] of [[ends[0], ends[1]], [ends[1], ends[0]]]) {
    from.peer.transport = {
      send: (frame) => {
        if (from.connection.destroyed) return false
        setImmediate(() => {
          if (to.connection.destroyed) return
          to.self.rx += Buffer.byteLength(frame)
          to.self.service.handlePeerPayload(to.peer, frame)
        })
        return true
      },
      ready: async () => true,
      close
    }
  }
  a.connections++
  b.connections++
  a.service.activatePeer(ends[0].peer)
  b.service.activatePeer(ends[1].peer)
}

function roomPeers (phone, roomKey) {
  const shown = phone.service.roomKeyFor(roomKey)
  let n = 0
  for (const peer of phone.service.peers.values()) if (peer.rooms?.includes(shown)) n++
  return n
}

async function waitFor (check) {
  const start = Date.now()
  while (Date.now() - start < WAIT_MS) {
    noteMemory()
    if (check()) return Date.now() - start
    await sleep(250)
  }
  return -1
}

// For each message, how many of these phones stored it, and when the last of
// them did.
function deliveryOf (sent, phones) {
  let got = 0
  let want = 0
  const lastMs = []
  for (const { id, from, at } of sent) {
    const receivers = phones.filter((phone) => phone !== from)
    want += receivers.length
    let last = 0
    let all = true
    for (const phone of receivers) {
      const t = phone.arrivals.get(id)
      if (t === undefined) all = false
      else {
        got++
        last = Math.max(last, t - at)
      }
    }
    if (all) lastMs.push(last)
  }
  lastMs.sort((x, y) => x - y)
  return { got, want, pct: want ? (100 * got) / want : 100, lastMaxMs: lastMs.at(-1) ?? 0, lastP50Ms: lastMs[Math.floor(lastMs.length / 2)] ?? 0 }
}

describe(`${N} phones in one PeerChat room`, { timeout: 9 * 60_000 }, () => {
  const phones = []
  let runDir
  let roomKey
  let creator
  let target
  let late
  let movedTo
  const results = {}

  before(async () => {
    runDir = mkdtempSync(path.join(tmpdir(), 'peerchat-thousand-'))
    for (let i = 0; i < N; i += 50) {
      phones.push(...await Promise.all(Array.from({ length: Math.min(50, N - i) }, (_, k) => makePhone(i + k, runDir))))
    }
    creator = phones[0]
  })

  after(async () => {
    for (const phone of [...phones, late].filter(Boolean)) {
      try { await phone.service.close() } catch {}
    }
    if (runDir) rmSync(runDir, { recursive: true, force: true })
  })

  it(`opens the room on every phone, each connected to about ${LINKS * 2} others`, async (t) => {
    ;({ roomKey } = await creator.service.createRoom({ name: 'A thousand', username: creator.name }))
    for (const phone of phones.slice(1)) await phone.service.joinRoom({ roomKey, username: phone.name })
    const start = Date.now()
    const pairs = new Set()
    for (const phone of phones) {
      for (let made = 0, tries = 0; made < LINKS && tries < LINKS * 10; tries++) {
        const other = phones[Math.floor(Math.random() * N)]
        const pair = phone.idx < other.idx ? `${phone.idx}-${other.idx}` : `${other.idx}-${phone.idx}`
        if (other === phone || pairs.has(pair)) continue
        pairs.add(pair)
        connect(phone, other)
        made++
      }
      if (phone.idx % 100 === 99) await sleep(20)
    }
    const open = await waitFor(() => phones.every((phone) => roomPeers(phone, roomKey) > 0))
    const ms = open === -1 ? -1 : Date.now() - start
    const counts = phones.map((phone) => phone.connections).sort((x, y) => x - y)
    results.connections = `${counts[Math.floor(N / 2)]}, ${counts.at(-1)}`
    results.open = seconds(ms)
    t.diagnostic(`${pairs.size} connections; per phone median ${counts[Math.floor(N / 2)]}, max ${counts.at(-1)}; room open everywhere after ${seconds(ms)}`)
    assert.notEqual(ms, -1, `the room opened on ${phones.filter((phone) => roomPeers(phone, roomKey) > 0).length} of ${N}`)
    // Room details, members and joins settle before anything is sent.
    await sleep(3000)
  })

  it('gets every message to every phone, in a few hops, taking each in once', async (t) => {
    const rxBefore = phones.reduce((sum, phone) => sum + phone.rx, 0)
    const sent = []
    for (let i = 0; i < MESSAGES; i++) {
      const from = phones[1 + Math.floor(Math.random() * (N - 1))]
      const at = Date.now()
      const message = await from.service.sendMessage({ roomKey, message: `Message ${i}` })
      sent.push({ id: message.id, from, at })
      await sleep(500)
    }
    await waitFor(() => deliveryOf(sent, phones).got === deliveryOf(sent, phones).want)
    const delivery = deliveryOf(sent, phones)
    const kb = (phones.reduce((sum, phone) => sum + phone.rx, 0) - rxBefore) / N / sent.length / 1024
    results.delivered = `${delivery.pct.toFixed(2)}%`
    results.last = seconds(delivery.lastMaxMs)
    results.perMessage = `${kb.toFixed(1)} KB`
    // One process does the work of every phone, so the times are its own.
    t.diagnostic(`${sent.length} messages, 2 a second: ${delivery.pct.toFixed(2)}% delivered; the last phone had each after ${seconds(delivery.lastP50Ms)} (median), ${seconds(delivery.lastMaxMs)} (slowest), with one process doing every phone's work; ${kb.toFixed(1)} KB taken in per phone per message`)
    assert.equal(delivery.got, delivery.want)
  })

  it('takes a removal to every phone, and every phone but the one removed to the new key', async (t) => {
    target = phones[1 + Math.floor(Math.random() * (N - 1))]
    ;({ movedTo } = await creator.service.removeRoomMember({ roomKey, peerId: target.key.slice(0, 8) }))
    assert.match(movedTo, /^[0-9a-f]{64}$/)
    const others = phones.filter((phone) => phone !== creator && phone !== target)
    const moved = (phone) => phone.service.movedRoomsMap()[roomKey] === movedTo
    const ms = await waitFor(() => others.every((phone) => phone.removalSeen && moved(phone)))
    const knew = others.filter((phone) => phone.removalSeen).length
    const followed = others.filter(moved).length
    results.knew = `${knew} of ${others.length}`
    results.followed = `${followed} of ${others.length}`
    results.reach = seconds(ms)
    t.diagnostic(`${knew} of ${others.length} knew of the removal and ${followed} followed the new key, after ${seconds(ms)}`)
    assert.equal(knew, others.length)
    assert.equal(followed, others.length)
    assert.equal(moved(target), false)
  })

  it('sends what is written after the move to everyone in the room, and nothing to the person removed or a newcomer with the old key', async (t) => {
    late = await makePhone(N, runDir)
    await late.service.joinRoom({ roomKey, username: late.name })
    for (let i = 0; i < 4; i++) connect(late, phones[1 + Math.floor(Math.random() * (N - 1))])
    await sleep(2000)
    const others = phones.filter((phone) => phone !== creator && phone !== target)
    const sent = []
    for (let i = 0; i < AFTER_MOVE; i++) {
      const from = others[Math.floor(Math.random() * others.length)]
      const at = Date.now()
      const message = await from.service.sendMessage({ roomKey, message: `After the move ${i}` })
      sent.push({ id: message.id, from, at })
      await sleep(300)
    }
    const inRoom = [creator, ...others]
    await waitFor(() => deliveryOf(sent, inRoom).got === deliveryOf(sent, inRoom).want)
    await sleep(2000)
    const delivery = deliveryOf(sent, inRoom)
    const leaked = (phone) => sent.filter(({ id }) => phone.arrivals.has(id)).length
    results.afterMove = `${delivery.pct.toFixed(2)}%`
    results.removedGot = leaked(target)
    results.lateGot = leaked(late)
    t.diagnostic(`after the move: ${delivery.pct.toFixed(2)}% delivered; the person removed got ${leaked(target)}, a newcomer with the old key ${leaked(late)}`)
    assert.equal(delivery.got, delivery.want)
    assert.equal(leaked(target), 0)
    assert.equal(leaked(late), 0)
  })

  it('never joins P2P Republic', (t) => {
    noteMemory()
    t.diagnostic([
      `| ${N} phones | |`,
      '|---|---|',
      `| Connections per phone (median, max) | ${results.connections} |`,
      `| Room open on every phone after | ${results.open} |`,
      `| Messages delivered | ${results.delivered} |`,
      `| Time until the last phone had a message (slowest) | ${results.last} |`,
      `| Data taken in per message, per phone | ${results.perMessage} |`,
      `| Phones that learned of a removal | ${results.knew} |`,
      `| Phones that followed the room's new key | ${results.followed} |`,
      `| Messages after the move that reached them | ${results.afterMove} |`,
      `| New messages the person removed got | ${results.removedGot} |`,
      `| New messages a newcomer with the old key got | ${results.lateGot} |`,
      `| Memory, all ${N} phones in one process | ${peakMB} MB (${peakHeapMB} MB of it JavaScript) |`
    ].join('\n'))
    assert.equal(republicJoins, 0)
  })
})
