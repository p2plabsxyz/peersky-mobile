import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import http from 'node:http'
import net from 'node:net'
import HyperDHT from 'hyperdht'
import createTestnet from 'hyperdht/testnet.js'
import z32 from 'z32'
// The desktop joins and hosts notes through Holesail itself. It is only a
// dev dependency here, to check the phone speaks the same protocol.
import Holesail from 'holesail'
import HolesailServer from 'holesail-server'
import HolesailClient from 'holesail-client'
import { noteAddress, parseNoteAddress, TunnelGuest, TunnelHost } from '../../backend/holesail/tunnel.mjs'

const PRIVATE_KEY = 'e7ad5d0b29335d515472b594ae9f9baedd317ad2e0c7df3580f369360b44b651'
const PUBLIC_SEED = '3f1c2b0d9e8a7f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a19087f6e'

const sha256 = (text) => createHash('sha256').update(text).digest()

describe('note addresses', () => {
  it('reads the flags and the key', () => {
    assert.deepEqual(parseNoteAddress('hs://s000' + PRIVATE_KEY), { key: PRIVATE_KEY, secure: true })
    assert.deepEqual(parseNoteAddress('hs://0000abcd'), { key: 'abcd', secure: false })
    assert.deepEqual(parseNoteAddress(PUBLIC_SEED), { key: PUBLIC_SEED, secure: undefined })
    assert.equal(noteAddress(PRIVATE_KEY, true), 'hs://s000' + PRIVATE_KEY)
    assert.equal(noteAddress('abcd', false), 'hs://0000abcd')
  })

  it('refuses a public key that is not a z32 public key', () => {
    assert.throws(() => new TunnelGuest({ key: 'hs://0000abc' }))
  })
})

// Holesail's own constructor only does the key maths, so it runs offline.
describe('the same keys as Holesail', () => {
  it('hosts a private note under the key pair Holesail makes', () => {
    const theirs = new Holesail({ server: true, key: 'hs://s000' + PRIVATE_KEY, port: 8989, host: '127.0.0.1' })
    const ours = new TunnelHost({ key: 'hs://s000' + PRIVATE_KEY, port: 8989 })
    const expected = HyperDHT.keyPair(Buffer.from(theirs.seed, 'hex')).publicKey
    assert.equal(ours.publicKey, z32.encode(expected))
    assert.equal(ours.info.url, 'hs://s000' + PRIVATE_KEY)
    assert.equal(ours.info.secure, true)
  })

  it('joins a private note on the key pair Holesail joins with', () => {
    const theirs = new Holesail({ client: true, key: 'hs://s000' + PRIVATE_KEY })
    const ours = new TunnelGuest({ key: 'hs://s000' + PRIVATE_KEY })
    const expected = HyperDHT.keyPair(z32.decode(theirs.seed))
    assert.ok(ours.keyPair.publicKey.equals(expected.publicKey))
    assert.ok(ours.keyPair.secretKey.equals(expected.secretKey))
    assert.equal(ours.info.url, 'hs://s000' + PRIVATE_KEY)
  })

  it('gives a public note the address Holesail gives it', () => {
    const theirs = new Holesail({ server: true, key: PUBLIC_SEED, secure: false, port: 8989, host: '127.0.0.1' })
    const ours = new TunnelHost({ key: PUBLIC_SEED, secure: false, port: 8989 })
    const expected = HyperDHT.keyPair(Buffer.from(theirs.seed, 'hex')).publicKey
    assert.equal(ours.info.url, 'hs://0000' + z32.encode(expected))
    assert.equal(ours.info.secure, false)
  })

  it('makes a new private key the way Holesail does', () => {
    const ours = new TunnelHost({ secure: true })
    assert.match(ours.info.url, /^hs:\/\/s000[0-9a-f]{64}$/)
    assert.equal(ours.publicKey, z32.encode(HyperDHT.keyPair(sha256(ours.key)).publicKey))
  })
})

describe('notes over a local test network', () => {
  let testnet
  let origin
  const closing = []

  before(async () => {
    testnet = await createTestnet(4)
    origin = await startOrigin()
  })

  after(async () => {
    for (const item of closing.reverse()) await item()
    await testnet.destroy()
    await new Promise((resolve) => origin.server.close(resolve))
  })

  const host = async (opts) => {
    const tunnel = new TunnelHost({ port: origin.port, bootstrap: testnet.bootstrap, ...opts })
    closing.push(() => tunnel.close())
    await tunnel.open()
    return tunnel
  }

  const guest = async (opts) => {
    const tunnel = new TunnelGuest({ port: 0, bootstrap: testnet.bootstrap, ...opts })
    closing.push(() => tunnel.close())
    await tunnel.open()
    return tunnel
  }

  it('carries a private note from its host to someone with the address', async () => {
    const hosted = await host({ secure: true })
    const joined = await guest({ key: hosted.info.url })
    assert.equal(joined.info.url, hosted.info.url)
    assert.ok(joined.info.port > 0)
    assert.equal(await fetchText(joined.info.port, '/note?via=tunnel'), 'origin /note?via=tunnel')
  })

  it('lets nobody in to a private note without its address', async () => {
    const hosted = await host({ secure: true })
    const stranger = testnet.createNode()
    closing.push(() => stranger.destroy())
    const socket = stranger.connect(hosted.keyPair.publicKey)
    const [error] = await once(socket, 'error')
    assert.ok(error)
  })

  it('carries a public note', async () => {
    const hosted = await host({ key: PUBLIC_SEED, secure: false })
    const joined = await guest({ key: hosted.info.url })
    assert.equal(await fetchText(joined.info.port, '/public'), 'origin /public')
  })

  it('listens on the port the host advertises when none is asked for', async () => {
    const hosted = await host({ secure: true })
    // The test origin already holds that port on this machine, which shows
    // the port came from the host's record.
    const tunnel = new TunnelGuest({ key: hosted.info.url, bootstrap: testnet.bootstrap })
    closing.push(() => tunnel.close())
    await assert.rejects(tunnel.open(), (error) => error.code === 'EADDRINUSE' && error.port === origin.port)
  })

  it('answers a request that closes its side first', async () => {
    const replies = await startReplyAtEnd()
    closing.push(() => new Promise((resolve) => replies.server.close(resolve)))
    const hosted = await host({ secure: true, port: replies.port })
    const joined = await guest({ key: hosted.info.url })
    assert.equal(await sendAndEnd(joined.info.port, 'ping'), 'got ping')
  })

  it('is joined by Holesail, which reads its record and passes its traffic', async () => {
    const hosted = await host({ key: 'hs://s000' + PRIVATE_KEY })
    const theirs = holesailClient(PRIVATE_KEY)
    closing.push(() => theirs.destroy())

    const record = await theirs.get()
    assert.deepEqual(JSON.parse(record.value), { host: '127.0.0.1', udp: false, port: origin.port })

    await new Promise((resolve) => theirs.connect({ port: 0, host: '127.0.0.1' }, resolve))
    assert.equal(hosted.info.url, 'hs://s000' + PRIVATE_KEY)
    assert.equal(await fetchText(theirs.proxy.address().port, '/from-holesail'), 'origin /from-holesail')
  })

  it('joins a note Holesail hosts', async () => {
    const key = 'a'.repeat(64)
    const theirs = holesailServer()
    closing.push(() => theirs.destroy())
    await theirs.start({ port: origin.port, host: '127.0.0.1', seed: sha256(key).toString('hex'), secure: true, udp: false })

    const joined = await guest({ key: 'hs://s000' + key })
    assert.equal(await fetchText(joined.info.port, '/to-holesail'), 'origin /to-holesail')
  })

  // Holesail's classes make their own DHT on the live network in their
  // constructors, so these build the same objects on the test network.
  function holesailServer () {
    const theirs = Object.create(HolesailServer.prototype)
    Object.assign(theirs, {
      logger: { log () {} },
      dht: testnet.createNode(),
      stats: {},
      server: null,
      keyPair: null,
      seed: null,
      state: null,
      connection: null,
      refreshInterval: null,
      activeConnections: new Map()
    })
    return theirs
  }

  function holesailClient (key) {
    const seed = sha256(key)
    const keyPair = HyperDHT.keyPair(seed)
    const theirs = Object.create(HolesailClient.prototype)
    Object.assign(theirs, {
      logger: { log () {} },
      seed: z32.encode(seed),
      secure: true,
      keyPair,
      publicKey: keyPair.publicKey,
      dht: testnet.createNode({ keyPair }),
      stats: {}
    })
    return theirs
  }
})

function startOrigin () {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('origin ' + req.url)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function fetchText (port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  return response.text()
}

// Answers once the request has ended, as a server reading to the end does.
function startReplyAtEnd () {
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let request = ''
    socket.on('data', (data) => { request += data })
    socket.on('end', () => socket.end('got ' + request))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// Sends a request, closes its own side, and reads the answer to the end.
function sendAndEnd (port, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true })
    let answer = ''
    socket.on('data', (data) => { answer += data })
    socket.on('end', () => resolve(answer))
    socket.on('error', reject)
    socket.end(request)
  })
}
