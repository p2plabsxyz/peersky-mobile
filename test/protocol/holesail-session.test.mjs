import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  connectHolesail,
  getHolesailStatus,
  recordBoundPort,
  startHolesailLive,
  stopHolesail,
  waitForClientProxy
} from '../../backend/holesail/session.mjs'

describe('holesail session validation', () => {
  afterEach(async () => {
    await stopHolesail()
  })

  it('starts with no active session', () => {
    assert.deepEqual(getHolesailStatus(), {
      ok: true,
      running: false,
      mode: null
    })
  })

  it('rejects invalid ports before creating a session', async () => {
    const result = await startHolesailLive({ port: 0 })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Invalid port. Expected an integer between 1 and 65535.')
    assert.equal(getHolesailStatus().running, false)
  })

  it('rejects non-loopback live hosts before creating a session', async () => {
    const result = await startHolesailLive({ host: '192.168.1.10' })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Host must be loopback (127.0.0.1, ::1, or localhost)')
    assert.equal(getHolesailStatus().running, false)
  })

  it('rejects unsafe bind hosts before creating a client proxy', async () => {
    const result = await connectHolesail({
      key: 'hs://abc123',
      host: '0.0.0.0'
    })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Host must be loopback (127.0.0.1, ::1, or localhost)')
    assert.equal(getHolesailStatus().running, false)
  })

  it('rejects malformed connection keys before creating a session', async () => {
    const result = await connectHolesail({ key: 'bad key with spaces' })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Invalid holesail key. Use hs://... or an alphanumeric key.')
    assert.equal(getHolesailStatus().running, false)
  })
})

// A join binds its local port after ready() is done. A port already taken
// here used to fail as an error nobody listened for, and took the whole
// backend down.
describe('holesail client proxy', () => {
  const client = (port = 59677) => {
    const proxy = new EventEmitter()
    return { proxy, instance: { dht: { proxy, args: { port }, state: 'waiting' } } }
  }

  it('waits for the local end to listen', async () => {
    const { proxy, instance } = client()
    const waiting = waitForClientProxy(instance)
    proxy.emit('listening')
    assert.deepEqual(await waiting, { ok: true })
  })

  it('answers with the port when it is already in use, instead of crashing', async () => {
    const { proxy, instance } = client(59677)
    const waiting = waitForClientProxy(instance)
    const busy = Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' })
    assert.doesNotThrow(() => proxy.emit('error', busy))
    const result = await waiting
    assert.equal(result.ok, false)
    assert.equal(result.port, 59677)
    assert.equal(result.error, busy)
  })

  it('never lets a later proxy error through', async () => {
    const { proxy, instance } = client()
    const waiting = waitForClientProxy(instance)
    proxy.emit('listening')
    await waiting
    assert.doesNotThrow(() => proxy.emit('error', new Error('connection reset')))
  })

  it('has nothing to wait for without a TCP proxy', async () => {
    assert.deepEqual(await waitForClientProxy({ dht: {} }), { ok: true })
    assert.deepEqual(await waitForClientProxy(null), { ok: true })
  })

  it('reports the port the system picked', () => {
    const { proxy, instance } = client(0)
    proxy.address = () => ({ address: '127.0.0.1', family: 'IPv4', port: 53111 })
    recordBoundPort(instance)
    assert.equal(instance.dht.args.port, 53111)
  })

  it('leaves the port alone when the socket is not listening yet', () => {
    const { proxy, instance } = client(0)
    proxy.address = () => null
    recordBoundPort(instance)
    assert.equal(instance.dht.args.port, 0)
    assert.doesNotThrow(() => recordBoundPort(null))
  })
})
