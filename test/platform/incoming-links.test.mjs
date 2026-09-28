import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_QUEUED_INCOMING_URLS,
  createIncomingUrlQueue
} from '../../app/incoming-url-queue.mjs'

const INVITE = 'peersky://p2p/peerchat/#room=3a893c0cc62c92857e00cc1896fafa9aa817b0a4e212ced6ca76e5ef3de539a6'

test('a link that arrives with nobody listening waits for the next screen', () => {
  const queue = createIncomingUrlQueue()
  queue.push(INVITE)

  const opened = []
  queue.subscribe((url) => opened.push(url))
  assert.deepEqual(opened, [INVITE])
})

// Tapping an invite in Notes sends expo-router to the unmatched route, which
// unmounts the browser and mounts a new one on the way back. The link used to
// be delivered to the screen on its way out and go nowhere.
test('a link delivered to a screen that goes away is replayed to the next one', () => {
  const queue = createIncomingUrlQueue()

  const leaving = []
  const unsubscribe = queue.subscribe((url) => leaving.push(url))
  queue.push(INVITE)
  assert.deepEqual(leaving, [INVITE])
  unsubscribe()

  const arriving = []
  queue.subscribe((url) => arriving.push(url))
  assert.deepEqual(arriving, [INVITE])
})

test('a link the browser loaded is not opened again on the next mount', () => {
  const queue = createIncomingUrlQueue()
  const unsubscribe = queue.subscribe(() => queue.settle(INVITE))
  queue.push(INVITE)
  unsubscribe()

  const reopened = []
  queue.subscribe((url) => reopened.push(url))
  assert.deepEqual(reopened, [])
  assert.deepEqual(queue.pending, [])
})

// A cold start reads the launch URL and hears the same one as an event.
test('the same link arriving twice opens one tab', () => {
  const queue = createIncomingUrlQueue()
  const opened = []
  queue.subscribe((url) => opened.push(url))

  queue.push(INVITE)
  queue.push(INVITE)
  assert.deepEqual(opened, [INVITE])
})

test('the same link can be opened again once it has been handled', () => {
  const queue = createIncomingUrlQueue()
  const opened = []
  queue.subscribe((url) => {
    opened.push(url)
    queue.settle(url)
  })

  queue.push(INVITE)
  queue.push(INVITE)
  assert.deepEqual(opened, [INVITE, INVITE])
})

test('a burst of links cannot grow without bound', () => {
  const queue = createIncomingUrlQueue()
  for (let index = 0; index < MAX_QUEUED_INCOMING_URLS + 3; index += 1) {
    queue.push(`https://example.com/${index}`)
  }

  assert.equal(queue.pending.length, MAX_QUEUED_INCOMING_URLS)
  assert.equal(queue.pending.at(-1), `https://example.com/${MAX_QUEUED_INCOMING_URLS + 2}`)
})

test('nothing that is not a link is queued', () => {
  const queue = createIncomingUrlQueue()
  queue.push(null)
  queue.push('')
  queue.push('   ')
  queue.push(undefined)
  assert.deepEqual(queue.pending, [])
})
