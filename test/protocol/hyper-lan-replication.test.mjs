import { randomBytes } from 'node:crypto'
import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import { create as createSDK } from 'hyper-sdk'
import { addLANReadinessBarrier } from '../../backend/hyper/lan-discovery.mjs'

test('replicates a newly created Hyperdrive over the LAN bridge', { timeout: 20_000 }, async (t) => {
  const storage = await mkdtemp(path.join(tmpdir(), 'peersky-mobile-lan-'))
  const bus = new Set()
  const sdks = []
  const lanPort = 40000 + (process.pid % 10000)

  t.after(async () => {
    await Promise.allSettled(sdks.map((sdk) => sdk.close()))
    await rm(storage, { recursive: true, force: true })
  })

  const first = await createSDK({
    storage: path.join(storage, 'first'),
    swarmOpts: { bootstrap: [], port: 0 }
  })
  sdks.push(first)
  const second = await createSDK({
    storage: path.join(storage, 'second'),
    swarmOpts: { bootstrap: [], port: 0 }
  })
  sdks.push(second)

  const firstLAN = addLANReadinessBarrier(new HyperDHTmDNS({
    host: '127.0.0.1',
    port: lanPort,
    allowLoopback: true,
    adapter: new MemoryAdapter(bus),
    keyPair: first.swarm.keyPair
  }), { settleMs: 50 })
  const secondLAN = addLANReadinessBarrier(new HyperDHTmDNS({
    host: '127.0.0.1',
    port: lanPort + 1,
    allowLoopback: true,
    adapter: new MemoryAdapter(bus),
    keyPair: second.swarm.keyPair
  }), { settleMs: 50 })

  await HyperDHTmDNS.attachHyperSDK(first, { lan: firstLAN })
  await HyperDHTmDNS.attachHyperSDK(second, { lan: secondLAN })

  const source = await first.getDrive(`mobile-${randomBytes(6).toString('hex')}`)
  await source.put('/index.html', Buffer.from('replicated from another mobile'))

  const replica = await second.getDrive(source.url)
  const content = await replica.get('/index.html')

  assert.equal(content?.toString(), 'replicated from another mobile')
  assert.equal(replica.core.length > 0, true)
})

class MemoryAdapter {
  constructor (bus) {
    this.bus = bus
    this.record = null
    this.handlers = null
  }

  browse (_query, handlers) {
    this.handlers = handlers
    let stopped = false

    return {
      stop: () => {
        if (stopped) return
        stopped = true
        this.handlers = null
      }
    }
  }

  advertise (record) {
    this.record = record

    for (const peer of this.bus) {
      setImmediate(() => {
        this.handlers?.onService(asService(peer.record))
        peer.handlers?.onService(asService(record))
      })
    }

    this.bus.add(this)
    let stopped = false

    return {
      stop: () => {
        if (stopped) return
        stopped = true
        if (this.record !== record) return

        this.bus.delete(this)
        for (const peer of this.bus) {
          setImmediate(() => peer.handlers?.onServiceDown(asService(record)))
        }
      }
    }
  }
}

function asService (record) {
  return {
    ...record,
    referer: { address: '127.0.0.1' },
    addresses: ['127.0.0.1']
  }
}
