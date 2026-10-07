// Names are not unique, so two people in a room can both be Alice. The profile
// card shows the short ID PeerChat already knows each person by: the first 8
// characters of their key, the same on the phone and on the desktop.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { normalizePeerChatPeerId } from '../../backend/peerchat/protocol.mjs'

test('the profile card shows the short ID between the name and the status', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const card = screen.slice(screen.indexOf('function PeerProfileModal'), screen.indexOf('function PeerChatQuestions'))
  const name = card.indexOf('{member.username}</Text>')
  const id = card.indexOf('ID {member.id}')
  const status = card.indexOf("member.self ? 'You' : formatMemberPresence(member)")
  assert.ok(name > -1 && id > name && status > id, 'the ID sits between the name and the status')
  // Selectable, so it can be copied and compared in another app.
  assert.match(card.slice(name, status), /selectable/)
})

test('the ID is the 8 character key start both apps use for a member', () => {
  assert.equal(normalizePeerChatPeerId('1A2B3C4D'), '1a2b3c4d')
  assert.equal(normalizePeerChatPeerId('1a2b3c4d5e'), '')
})
