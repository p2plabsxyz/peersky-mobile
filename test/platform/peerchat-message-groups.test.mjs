import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { GROUP_GAP_MS, groupPeerChatMessages, joinsGroup } from '../../app/peerchat/message-groups.mjs'

const minute = 60_000
const at = (hours, minutes) => new Date(2026, 9, 12, hours, minutes).getTime()
const timeText = (message) => {
  const date = new Date(message.timestamp)
  return `${date.getHours()}:${date.getMinutes()}`
}

test('back to back from one person, under five minutes and on one day, is one group', () => {
  assert.equal(GROUP_GAP_MS, 5 * minute)
  assert.equal(joinsGroup({ sender: 'ada', ts: at(10, 0) }, { sender: 'ada', ts: at(10, 4) }), true)
  assert.equal(joinsGroup({ sender: 'ada', ts: at(10, 0) }, { sender: 'ada', ts: at(10, 5) }), false)
  assert.equal(joinsGroup({ sender: 'ada', ts: at(10, 0) }, { sender: 'cal', ts: at(10, 1) }), false)
  assert.equal(joinsGroup({ sender: '', ts: at(10, 0) }, { sender: '', ts: at(10, 1) }), false)
  // Out of order never joins.
  assert.equal(joinsGroup({ sender: 'ada', ts: at(10, 3) }, { sender: 'ada', ts: at(10, 1) }), false)
  // Two minutes apart, across midnight, is a new day.
  assert.equal(joinsGroup(
    { sender: 'ada', ts: new Date(2026, 9, 12, 23, 59).getTime() },
    { sender: 'ada', ts: new Date(2026, 9, 13, 0, 1).getTime() }
  ), false)
})

test('a group shows the name once, sits close together, and its last message keeps its time', () => {
  const messages = [
    { id: '1', sender: 'ada', timestamp: at(10, 0) },
    { id: '2', sender: 'ada', timestamp: at(10, 0) + 10_000 },
    { id: '3', sender: 'ada', timestamp: at(10, 2) },
    { id: '4', sender: 'cal', timestamp: at(10, 3) },
    { id: '5', sender: '', system: true, timestamp: at(10, 3) + 1000 },
    { id: '6', sender: 'cal', timestamp: at(10, 3) + 2000 },
    { id: '7', sender: 'me-phone', self: true, timestamp: at(10, 4) },
    // Your own from your other device is still yours.
    { id: '8', sender: 'me-desktop', self: true, timestamp: at(10, 4) + 1000 }
  ]
  assert.deepEqual(groupPeerChatMessages(messages, timeText), [
    // The same minute as the next one in the group, so only that one shows it.
    { grouped: false, followed: true, sameTime: true },
    { grouped: true, followed: true, sameTime: false },
    { grouped: true, followed: false, sameTime: false },
    { grouped: false, followed: false, sameTime: false },
    // A notice between two messages keeps them apart.
    { grouped: false, followed: false, sameTime: false },
    { grouped: false, followed: false, sameTime: false },
    { grouped: false, followed: true, sameTime: true },
    { grouped: true, followed: false, sameTime: false }
  ])
  assert.deepEqual(groupPeerChatMessages(null, timeText), [])
})

test('the chat hides the name, the gap and the time the groups say to', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /groupPeerChatMessages\(visibleMessages, \(message: PeerChatMessage\) => formatMessageTime\(message\.timestamp\)\)/)
  assert.match(screen, /\{!item\.self && !item\.system && !place\?\.grouped && \(/)
  assert.match(screen, /place\?\.followed \? styles\.messageRowFollowed : null/)
  assert.match(screen, /\{!place\?\.sameTime && \(\s+<Text style=\{\[styles\.messageTime/)
  assert.match(screen, /messageRowFollowed: \{ marginBottom: 2 \}/)
  // A date line only comes with a new day, which a group never spans.
  assert.match(screen, /\{!!dateLabel && dateLabel !== previousDateLabel && \(/)
})
