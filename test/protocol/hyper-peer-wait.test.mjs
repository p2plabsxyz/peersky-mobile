import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  NO_PEERS_MEMORY_MS,
  isAwaitingFirstPeer,
  waitForFirstPeer
} from '../../backend/hyper/peer-wait.mjs'

// A drive nobody shares: its length never arrives.
function unansweredDrive () {
  const drive = { writable: false, updates: 0 }
  drive.core = {
    length: 0,
    peers: [],
    update: () => {
      drive.updates += 1
      return new Promise(() => {})
    }
  }
  return drive
}

test('reads a drive at once when it already has something or is this phone\'s own', async () => {
  const known = { core: { length: 3, update: () => { throw new Error('should not wait') } } }
  const own = { writable: true, core: { length: 0, update: () => { throw new Error('should not wait') } } }
  assert.equal(isAwaitingFirstPeer(known), false)
  assert.equal(isAwaitingFirstPeer(own), false)
  assert.equal(await waitForFirstPeer(known, null), true)
  assert.equal(await waitForFirstPeer(own, null), true)
})

test('says nobody answered once the wait runs out', async () => {
  const drive = unansweredDrive()
  const startedAt = Date.now()
  assert.equal(await waitForFirstPeer(drive, null, { timeoutMs: 20 }), false)
  assert.ok(Date.now() - startedAt < 2000)
  assert.equal(drive.updates, 1)
})

// A page asks for its next file, or PeerTunes for the folder after its
// playlist, right after the first read found nobody.
test('answers the next read of the same drive at once for a moment, then looks again', async () => {
  const drive = unansweredDrive()
  let clock = 1000
  const now = () => clock

  assert.equal(await waitForFirstPeer(drive, null, { timeoutMs: 20, now }), false)
  clock += NO_PEERS_MEMORY_MS - 1
  const startedAt = Date.now()
  assert.equal(await waitForFirstPeer(drive, null, { timeoutMs: 5000, now }), false)
  assert.ok(Date.now() - startedAt < 500)
  assert.equal(drive.updates, 1)

  clock += 2
  assert.equal(await waitForFirstPeer(drive, null, { timeoutMs: 20, now }), false)
  assert.equal(drive.updates, 2)
})

test('reads a drive whose first peer answers, and forgets that nobody did before', async () => {
  const drive = unansweredDrive()
  const now = () => 1000
  assert.equal(await waitForFirstPeer(drive, null, { timeoutMs: 20, now }), false)

  // Someone came online and the drive's length arrived some other way.
  drive.core.length = 5
  assert.equal(await waitForFirstPeer(drive, null, { now }), true)

  const answering = { writable: false, core: { length: 0, peers: [] } }
  answering.core.update = async () => { answering.core.length = 2 }
  assert.equal(await waitForFirstPeer(answering, null, { timeoutMs: 5000, now }), true)
})

// A typed hyper:// address, a page's files and PeerTunes all read through
// fetchHyper. The wait has to come before the read, or an empty drive answers
// "not found" and the page says the drive answered.
test('fetchHyper looks for a peer before reading and says nobody has the drive', async () => {
  const source = await readFile(new URL('../../backend/hyper/fetch.mjs', import.meta.url), 'utf8')
  const read = source.slice(source.indexOf('const read = () => withHyperRuntimeForAddress'))
  const wait = read.indexOf('await waitForFirstPeer(drive, runtime')
  const fetch = read.indexOf('await getHyperFetch(runtime)')
  assert.ok(wait > 0 && fetch > wait)
  assert.match(read.slice(wait, fetch), /status: 503, code: NO_PEERS_CODE, error: NO_PEERS_ERROR/)
})
