import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collapsePeerChatMembers } from '../../backend/peerchat/members.mjs'

const member = (id, username, extra = {}) => ({
  id,
  username,
  bio: '',
  avatar: null,
  self: false,
  online: false,
  ...extra
})

// A peer id comes from a device key, so a reinstall or a second device arrives
// as a new member with the same name. The room remembers both and the list
// showed the same person two or three times over.

test('one row per person, however many keys they have arrived with', () => {
  const collapsed = collapsePeerChatMembers([
    member('aaaa1111', 'Prasanna'),
    member('bbbb2222', 'Prasanna'),
    member('cccc3333', 'Prasanna')
  ])

  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].username, 'Prasanna')
})

test('the copy that is here now is the one kept', () => {
  const collapsed = collapsePeerChatMembers([
    member('aaaa1111', 'Prasanna'),
    member('bbbb2222', 'Prasanna', { online: true }),
    member('cccc3333', 'Prasanna')
  ])

  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].id, 'bbbb2222')
  assert.equal(collapsed[0].online, true)
})

test('you are always yourself, even next to an older key of yours', () => {
  const collapsed = collapsePeerChatMembers([
    member('bbbb2222', 'Akhilesh', { online: true }),
    member('aaaa1111', 'Akhilesh', { self: true, online: true })
  ])

  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].self, true)
  assert.equal(collapsed[0].id, 'aaaa1111')
})

test('different people are left alone', () => {
  const collapsed = collapsePeerChatMembers([
    member('aaaa1111', 'Prasanna'),
    member('bbbb2222', 'Akhilesh'),
    member('cccc3333', 'Bob')
  ])

  assert.deepEqual(collapsed.map((item) => item.username), ['Prasanna', 'Akhilesh', 'Bob'])
})

test('a name is a name whatever its capitals', () => {
  const collapsed = collapsePeerChatMembers([
    member('aaaa1111', 'Prasanna'),
    member('bbbb2222', 'prasanna', { online: true })
  ])

  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].id, 'bbbb2222')
})

test('somebody with no name at all is kept apart by their key', () => {
  const collapsed = collapsePeerChatMembers([
    member('aaaa1111', ''),
    member('bbbb2222', '')
  ])

  assert.equal(collapsed.length, 2)
})

test('nothing in, nothing out', () => {
  assert.deepEqual(collapsePeerChatMembers([]), [])
})
