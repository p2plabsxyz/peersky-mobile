import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  addMulticastSupport,
  createMobileMDNSOptions
} from '../../backend/hyper/mobile-mdns.mjs'

describe('Mobile mDNS socket compatibility', () => {
  it('binds Bonjour to IPv4 and the selected Wi-Fi interface', () => {
    const socket = fakeSocket()
    let bonjourOptions = null
    const onError = () => {}
    let publishedRecord = null
    class FakeBonjour {
      constructor (options, callback) {
        bonjourOptions = options
        assert.equal(callback, onError)
      }

      publish (record) {
        publishedRecord = record
        return record
      }
    }

    const options = createMobileMDNSOptions('10.0.0.8', {
      Bonjour: FakeBonjour,
      createSocket: (socketOptions) => {
        assert.deepEqual(socketOptions, { reuseAddress: true })
        return socket
      }
    })

    const bonjour = options.createBonjour(onError)
    bonjour.publish({ name: 'peer', type: 'hyperdht-mdns', port: 49799 })

    assert.equal(bonjourOptions.bind, '0.0.0.0')
    assert.equal(bonjourOptions.interface, '10.0.0.8')
    assert.equal(bonjourOptions.socket, socket)
    assert.equal(publishedRecord.disableIPv6, true)
    assert.equal(publishedRecord.probe, false)
  })

  it('forwards multicast operations to the underlying UDX socket', () => {
    const calls = []
    const socket = fakeSocket(calls)

    addMulticastSupport(socket)
    socket.addMembership('224.0.0.251', '10.0.0.8')
    socket.dropMembership('224.0.0.251', '10.0.0.8')
    socket.setMulticastTTL(255)

    assert.deepEqual(calls, [
      ['add', '224.0.0.251', '10.0.0.8'],
      ['drop', '224.0.0.251', '10.0.0.8'],
      ['ttl', 255]
    ])
    assert.equal(socket.setMulticastLoopback(true), socket)
    assert.equal(socket.setMulticastInterface('10.0.0.8'), socket)
  })
})

function fakeSocket (calls = []) {
  return {
    _socket: {
      addMembership: (group, host) => calls.push(['add', group, host]),
      dropMembership: (group, host) => calls.push(['drop', group, host]),
      setTTL: (ttl) => calls.push(['ttl', ttl])
    }
  }
}
