import { EventEmitter } from 'node:events'
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'

import {
  addLANReadinessBarrier,
  getLANDiscoveryStatus,
  resetLANDiscovery,
  startLANDiscovery
} from '../../backend/hyper/lan-discovery.mjs'

describe('Hyper LAN discovery', () => {
  beforeEach(() => {
    resetLANDiscovery()
  })

  it('attaches hyperdht-mdns, with the Hyper SDK swarm key only for version 1', async () => {
    const keyPair = { publicKey: Buffer.alloc(32, 1), secretKey: Buffer.alloc(64, 2) }
    const runtime = { swarm: { keyPair } }
    const instance = new FakeLAN('192.168.1.25', 49799)
    let createdOptions = null
    let attachedOptions = null

    const status = await startLANDiscovery(runtime, {
      createLAN: (options) => {
        createdOptions = options
        return instance
      },
      attach: async (attachedRuntime, options) => {
        assert.equal(attachedRuntime, runtime)
        attachedOptions = options
        return instance
      }
    })

    // Version 2 makes up a key for each network: the store's key, which is
    // also PeerChat's id, stays off the LAN.
    if (typeof HyperDHTmDNS.identityGate === 'function') assert.equal('keyPair' in createdOptions, false)
    else assert.equal(createdOptions.keyPair, keyPair)
    assert.equal(attachedOptions.lan, instance)
    assert.deepEqual(status, {
      available: true,
      host: '192.168.1.25',
      port: 49799,
      publicKey: '',
      joinedTopics: 0,
      activeConnections: 0,
      peers: []
    })
    assert.deepEqual(getLANDiscoveryStatus(), status)
  })

  it('does not attach twice while LAN discovery is active', async () => {
    const runtime = { swarm: { keyPair: {} } }
    const instance = new FakeLAN('10.0.0.4', 49799)
    let attachCount = 0
    const options = {
      createLAN: () => instance,
      attach: async () => {
        attachCount += 1
        return instance
      }
    }

    await startLANDiscovery(runtime, options)
    await startLANDiscovery(runtime, options)

    assert.equal(attachCount, 1)
  })

  it('starts without Hyper storage and attaches the same instance later', async () => {
    const runtime = { swarm: { keyPair: {} } }
    const instance = new FakeLAN('10.0.0.6', 49799)
    let createdOptions = null
    let attachedLAN = null

    await startLANDiscovery(null, {
      createLAN: (options) => {
        createdOptions = options
        return instance
      }
    })
    await startLANDiscovery(runtime, {
      attach: async (attachedRuntime, options) => {
        assert.equal(attachedRuntime, runtime)
        attachedLAN = options.lan
        return instance
      }
    })

    assert.equal('keyPair' in createdOptions, false)
    assert.equal(attachedLAN, instance)
    assert.equal(getLANDiscoveryStatus().available, true)
  })

  it('shares one opening operation across concurrent status requests', async () => {
    const instance = new FakeLAN('10.0.0.7', 49799)
    let createCount = 0
    let releaseReady
    instance.ready = () => new Promise((resolve) => { releaseReady = resolve })
    const options = {
      createLAN: () => {
        createCount += 1
        return instance
      }
    }

    const first = startLANDiscovery(null, options)
    const second = startLANDiscovery(null, options)
    await Promise.resolve()
    releaseReady()
    await Promise.all([first, second])

    assert.equal(createCount, 1)
  })

  it('keeps mDNS errors from becoming uncaught EventEmitter errors', async () => {
    const runtime = { swarm: { keyPair: {} } }
    const instance = new FakeLAN('10.0.0.5', 49799)
    const errors = []
    const warnings = []

    await startLANDiscovery(runtime, {
      createLAN: () => instance,
      attach: async () => instance,
      logger: {
        error: (message) => errors.push(message),
        warn: (message) => warnings.push(message)
      }
    })

    assert.doesNotThrow(() => instance.emit('error', new Error('mDNS socket failed')))
    instance.emit('warning', new Error('invalid LAN record'))

    assert.deepEqual(errors, ['[LAN] mDNS socket failed'])
    assert.deepEqual(warnings, ['[LAN] invalid LAN record'])
  })

  it('reports discovered peers and removes peers that go down', async () => {
    const runtime = { swarm: { keyPair: {} } }
    const instance = new FakeLAN('10.0.0.5', 49799)
    const publicKey = Buffer.alloc(32, 7)

    await startLANDiscovery(runtime, {
      createLAN: () => instance,
      attach: async () => instance
    })

    instance.emit('peer', {
      host: '10.0.0.8',
      port: 49799,
      publicKey,
      reachable: false,
      topics: [Buffer.alloc(32)]
    })
    instance.emit('peer-reachable', {
      host: '10.0.0.8',
      port: 49799,
      publicKey,
      reachable: true,
      topics: [Buffer.alloc(32)]
    })

    const peer = getLANDiscoveryStatus().peers[0]
    assert.equal(peer.publicKey, publicKey.toString('hex'))
    assert.equal(peer.host, '10.0.0.8')
    assert.equal(peer.port, 49799)
    assert.equal(peer.reachable, true)
    assert.equal(peer.sharedTopics, 1)
    assert.equal(typeof peer.lastSeen, 'number')

    instance.emit('peer-down', { txt: { peerKey: publicKey.toString('hex') } })
    assert.deepEqual(getLANDiscoveryStatus().peers, [])
  })

  it('distinguishes a reachable peer from an active replication connection', async () => {
    const runtime = { swarm: { keyPair: {} } }
    const instance = new FakeLAN('10.0.0.5', 49799)
    const publicKey = Buffer.alloc(32, 8)
    const socket = new EventEmitter()

    await startLANDiscovery(runtime, {
      createLAN: () => instance,
      attach: async () => instance
    })

    instance.emit('peer-reachable', {
      host: '10.0.0.9',
      port: 49799,
      publicKey,
      reachable: true,
      topics: [Buffer.alloc(32)]
    })

    assert.equal(getLANDiscoveryStatus().peers[0].connected, false)

    instance.emit('connection', socket, {
      publicKey,
      topics: [Buffer.alloc(32)],
      lan: true
    })

    let connectionStatus = getLANDiscoveryStatus()
    assert.equal(connectionStatus.activeConnections, 1)
    assert.equal(connectionStatus.peers[0].connected, true)
    assert.equal(connectionStatus.peers[0].activeConnections, 1)
    assert.equal(typeof connectionStatus.peers[0].lastConnected, 'number')

    socket.emit('close')
    connectionStatus = getLANDiscoveryStatus()
    assert.equal(connectionStatus.activeConnections, 0)
    assert.equal(connectionStatus.peers[0].connected, false)
  })

  it('waits for the queued topic advertisement before flushing discovery', async () => {
    let publishTopic
    let flushed = false
    const instance = {
      _advertisementQueue: new Promise((resolve) => { publishTopic = resolve }),
      flush: async () => { flushed = true },
      join: () => ({
        flushed: async () => { flushed = true }
      })
    }

    addLANReadinessBarrier(instance, { settleMs: 0 })

    const instanceFlush = instance.flush()
    await Promise.resolve()
    assert.equal(flushed, false)
    publishTopic()
    await instanceFlush
    assert.equal(flushed, true)

    flushed = false
    instance._advertisementQueue = Promise.resolve()
    await instance.join(Buffer.alloc(32)).flushed()
    assert.equal(flushed, true)
  })

  it('keeps Hyper available and cleans up when multicast startup fails', async () => {
    const runtime = { swarm: { keyPair: {} } }
    const instance = new FakeLAN('', null, new Error('Wi-Fi multicast unavailable'))
    const warnings = []
    let attachCalled = false

    const status = await startLANDiscovery(runtime, {
      createLAN: () => instance,
      attach: async () => {
        attachCalled = true
        return instance
      },
      logger: {
        error: () => {},
        warn: (message) => warnings.push(message)
      }
    })

    assert.equal(attachCalled, false)
    assert.deepEqual(status, {
      available: false,
      error: 'Wi-Fi multicast unavailable',
      joinedTopics: 0,
      activeConnections: 0,
      peers: []
    })
    assert.equal(instance.destroyed, true)
    assert.deepEqual(warnings, [
      '[LAN] Local discovery unavailable: Wi-Fi multicast unavailable'
    ])
  })
  it('retries on an ephemeral port when the fixed LAN port is taken', async () => {
    // A desktop PeerSky on the same machine already holds the default port, so
    // the first attempt fails and the second must bind whatever the OS gives us.
    const requestedPorts = []
    const status = await startLANDiscovery(null, {
      pickFallbackPort: () => 51234,
      createLAN: (options) => {
        requestedPorts.push(options.port)
        return options.port === 51234
          ? new FakeLAN('192.168.1.25', 51234)
          : new FakeLAN('192.168.1.25', 49799, new Error(
            'LAN DHT port 49799 is already in use. Choose a different fixed port for another local instance.'
          ))
      },
      logger: { warn () {} }
    })

    assert.deepEqual(requestedPorts, [undefined, 51234])
    assert.equal(status.available, true)
    assert.equal(status.port, 51234)
  })

  it('gives up without retrying when a caller pinned the LAN port', async () => {
    const requestedPorts = []
    const status = await startLANDiscovery(null, {
      lanOptions: { port: 49799 },
      createLAN: (options) => {
        requestedPorts.push(options.port)
        return new FakeLAN('192.168.1.25', 49799, new Error('address already in use'))
      },
      logger: { warn () {} }
    })

    assert.deepEqual(requestedPorts, [49799])
    assert.equal(status.available, false)
  })
})

class FakeLAN extends EventEmitter {
  constructor (host, port, readyError = null) {
    super()
    this.host = host
    this.port = port
    this.readyError = readyError
    this.destroyed = false
  }

  async ready () {
    if (this.readyError) throw this.readyError
  }

  async destroy () {
    this.destroyed = true
  }
}
