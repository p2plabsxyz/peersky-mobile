import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createPeerActivityStore, createPeerPresenceStore } from '../../backend/p2pmd/peers.mjs'

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
        1: { name: 'Desktop', color: '#59a6ff', clientId: 'desktop-peer', updatedAt: 1234 }
      }
    })

    const peers = store.getPeerList(new Set([hostKey, clientKey]))
    const host = peers.find((peer) => peer.clientId === 'phone-host')
    const client = peers.find((peer) => peer.clientId === 'desktop-peer')

    assert.equal(host.lineAttributions, null)
    assert.deepEqual(client.lineAttributions, {
      1: { color: '#59a6ff', name: 'Desktop', clientId: 'desktop-peer', updatedAt: 1234 }
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

  it('preserves active editor state when document updates omit presence fields', () => {
    const store = createPeerPresenceStore({ now: createClock() })
    const peerKey = store.upsert({
      clientId: 'phone-peer',
      role: 'client',
      isTyping: true,
      cursorLine: 7,
      cursorColumn: 12,
      selectionStart: 42,
      selectionEnd: 45
    })

    store.upsert({ clientId: 'phone-peer', role: 'client', name: 'Phone' })
    let [peer] = store.getPeerList(new Set([peerKey]))

    assert.equal(peer.isTyping, true)
    assert.equal(peer.cursorLine, 7)
    assert.equal(peer.cursorColumn, 12)
    assert.equal(peer.selectionStart, 42)
    assert.equal(peer.selectionEnd, 45)

    store.upsert({ clientId: 'phone-peer', role: 'client', isTyping: false, cursorLine: null })
    ;[peer] = store.getPeerList(new Set([peerKey]))
    assert.equal(peer.isTyping, false)
    assert.equal(peer.cursorLine, null)
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

describe('p2pmd peer activity', () => {
  it('records desktop-compatible join, edit, and leave messages', () => {
    const store = createPeerActivityStore({ now: createClock() })

    const joined = store.add({ type: 'join', role: 'host', name: 'Harshal', clientId: 'host-1' })
    const edited = store.add({
      type: 'edit',
      role: 'client',
      name: 'Phone',
      clientId: 'client-1',
      cursorLine: 4,
      cursorColumn: 8
    })
    const left = store.add({ type: 'leave', role: 'client', name: 'Phone', clientId: 'client-1' })

    assert.equal(joined.message, 'Harshal joined as host')
    assert.equal(edited.message, 'Phone edited the document (line 4, col 8)')
    assert.equal(left.message, 'Phone left the room')
    assert.deepEqual(store.getActivity().map((entry) => entry.type), ['leave', 'edit', 'join'])
  })

  it('bounds retained activity and sanitizes remote fields', () => {
    const store = createPeerActivityStore({ now: createClock(), maxItems: 2 })

    store.add({ type: 'join', name: 'First' })
    store.add({ type: 'edit', name: 'x'.repeat(100), clientId: 'y'.repeat(140) })
    store.add({ type: 'leave', name: 'Last' })

    const activity = store.getActivity(50)
    assert.equal(activity.length, 2)
    assert.equal(activity[0].name, 'Last')
    assert.equal(activity[1].name.length, 80)
    assert.equal(activity[1].clientId.length, 120)
  })
})

describe('p2pmd people list for a whole room', () => {
  // An editor sends all of its lines with every edit and cursor move, and the
  // list goes to everyone in the note, so a person's line authors go out again
  // only when they change.
  it('puts someone\'s line authors in the list for everyone only when they changed', () => {
    const store = createPeerPresenceStore({ now: createClock() })
    const authors = { 1: { name: 'Desktop', color: '#59a6ff' }, 2: { name: 'Desktop', color: '#59a6ff' } }
    const desktop = store.upsert({ clientId: 'desktop-peer', role: 'client', name: 'Desktop', color: '#59a6ff', lineAttributions: authors })
    const phone = store.upsert({ clientId: 'phone-host', role: 'host', name: 'Phone', color: '#f2d35b' })
    const active = new Set([desktop, phone])
    const desktopIn = (list) => list.find((peer) => peer.clientId === 'desktop-peer')

    assert.deepEqual(Object.keys(desktopIn(store.takePeerListUpdate(active)).lineAttributions), ['1', '2'])

    // The same lines with a cursor move: where they are, not who wrote what.
    store.upsert({ clientId: 'desktop-peer', role: 'client', cursorLine: 2, lineAttributions: authors })
    const quiet = desktopIn(store.takePeerListUpdate(active))
    assert.equal(quiet.lineAttributions, null)
    assert.equal(quiet.cursorLine, 2)
    // Whoever connects gets the whole list, authors and all.
    assert.deepEqual(Object.keys(desktopIn(store.getPeerList(active)).lineAttributions), ['1', '2'])

    store.upsert({ clientId: 'desktop-peer', role: 'client', lineAttributions: { ...authors, 3: { name: 'Desktop', color: '#59a6ff' } } })
    assert.deepEqual(Object.keys(desktopIn(store.takePeerListUpdate(active)).lineAttributions), ['1', '2', '3'])

    // Losing a line to someone else is a change too.
    store.upsert({ clientId: 'phone-host', role: 'host', lineAttributions: { 3: { name: 'Phone', color: '#f2d35b' } } })
    assert.deepEqual(Object.keys(desktopIn(store.takePeerListUpdate(active)).lineAttributions), ['1', '2'])
    assert.equal(desktopIn(store.takePeerListUpdate(active)).lineAttributions, null)
  })
})

function createClock () {
  let value = 1000
  return () => value++
}
