import { EventEmitter } from 'node:events'
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  getLANDiscoveryStatus,
  resetLANDiscovery,
  startLANDiscovery
} from '../../backend/hyper/lan-discovery.mjs'

describe('Hyper LAN discovery', () => {
  beforeEach(() => {
    resetLANDiscovery()
  })

  it('attaches hyperdht-mdns with the Hyper SDK swarm identity', async () => {
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

    assert.equal(createdOptions.keyPair, keyPair)
    assert.equal(attachedOptions.lan, instance)
    assert.deepEqual(status, {
      available: true,
      host: '192.168.1.25',
      port: 49799,
      publicKey: '',
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
      peers: []
    })
    assert.equal(instance.destroyed, true)
    assert.deepEqual(warnings, [
      '[LAN] Local discovery unavailable: Wi-Fi multicast unavailable'
    ])
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
