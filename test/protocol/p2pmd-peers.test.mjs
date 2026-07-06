import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPeerPresenceStore } from '../../backend/p2pmd/peers.mjs'

describe('p2pmd peer presence simulation', () => {
  it('tracks host/client joins and counts only non-host peers', () => {
    const store = createPeerPresenceStore({ now: createClock() })
    const hostKey = store.upsert({
      clientId: 'phone-host',
      role: 'host',
      name: 'Phone',
      color: '#f2d35b'
    })
    const clientKey = store.upsert({
      clientId: 'desktop-peer',
      role: 'client',
      name: 'Desktop',
      color: '#59a6ff'
    })
    const activePeerKeys = new Set([hostKey, clientKey])

    assert.equal(store.getPeerCount(activePeerKeys), 1)
    assert.deepEqual(store.getPeerList(activePeerKeys).map((peer) => peer.clientId), [
      'phone-host',
      'desktop-peer'
    ])
  })

  it('moves line ownership when another peer writes the same line', () => {
    const store = createPeerPresenceStore({ now: createClock() })
    const hostKey = store.upsert({
      clientId: 'phone-host',
      role: 'host',
      name: 'Phone',
      color: '#f2d35b',
      lineAttributions: {
        1: { name: 'Phone', color: '#f2d35b' }
      }
    })
    const clientKey = store.upsert({
      clientId: 'desktop-peer',
      role: 'client',
      name: 'Desktop',
      color: '#59a6ff',
      lineAttributions: {
        2: { name: 'Desktop', color: '#59a6ff' }
      }
    })

    store.upsert({
      clientId: 'desktop-peer',
      role: 'client',
      name: 'Desktop',
      color: '#59a6ff',
      cursorLine: 1,
      cursorColumn: 8,
      lineAttributions: {
        1: { name: 'Desktop', color: '#59a6ff' }
      }
    })

    const peers = store.getPeerList(new Set([hostKey, clientKey]))
    const host = peers.find((peer) => peer.clientId === 'phone-host')
    const client = peers.find((peer) => peer.clientId === 'desktop-peer')

    assert.equal(host.lineAttributions, null)
    assert.deepEqual(client.lineAttributions, {
      1: { color: '#59a6ff', name: 'Desktop' }
    })
    assert.equal(client.cursorLine, 1)
    assert.equal(client.cursorColumn, 8)
  })

  it('prunes stale peer presence after a peer disconnects', () => {
    const store = createPeerPresenceStore({ now: createClock() })
    const hostKey = store.upsert({ clientId: 'phone-host', role: 'host' })
    const clientKey = store.upsert({ clientId: 'desktop-peer', role: 'client' })

    assert.equal(store.prune(clientKey, new Set([hostKey])), true)
    assert.equal(store.getPeerCount(new Set([hostKey])), 0)
    assert.deepEqual(store.getPeerList(new Set([hostKey])).map((peer) => peer.clientId), [
      'phone-host'
    ])
  })

  it('keeps peer defaults bounded and sanitized', () => {
    const store = createPeerPresenceStore({ now: createClock() })
    const peerKey = store.upsert({
      name: 'x'.repeat(100),
      color: 'y'.repeat(100),
      role: 'unknown',
      cursorLine: 'not-a-number',
      lineAttributions: {
        0: { name: 'Bad', color: '#bad' },
        1: { name: 'Valid', color: '#123456' }
      }
    })
    const [peer] = store.getPeerList(new Set([peerKey]))

    assert.match(peer.clientId, /^anonymous-/)
    assert.equal(peer.role, 'viewer')
    assert.equal(peer.name.length, 80)
    assert.equal(peer.color, '')
    assert.equal(peer.cursorLine, null)
    assert.deepEqual(peer.lineAttributions, {
      1: { color: '#123456', name: 'Valid' }
    })
  })
})

function createClock () {
  let value = 1000
  return () => value++
}
