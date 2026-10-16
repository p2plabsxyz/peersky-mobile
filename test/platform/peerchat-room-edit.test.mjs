import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

// The backend took a change from the person who made a room, signed it and
// sent it to everyone in the room, but the phone had no way to make one.
test('Room info offers Edit room only to the person who made a group', () => {
  const canEdit = screen.slice(screen.indexOf('function canEditRoom ('), screen.indexOf('function nextSpamRateLimit ('))
  assert.match(canEdit, /return Boolean\(room\?\.isCreator && !room\.isDM && !room\.removedByCreator\)/)
  const info = screen.slice(screen.indexOf('visible={showRoomInfo}'), screen.indexOf('visible={roomDraft !== null}'))
  assert.match(info, /\{canEditRoom\(activeRoom\) && \(\s+<Pressable[\s\S]{0,400}onPress=\{openEditRoom\}/)
  assert.match(info, />\{t\('Edit room'\)\}<\/Text>/)
})

test('Edit room opens with the room as it is, closing Room info first', () => {
  const open = screen.slice(screen.indexOf('function openEditRoom ('), screen.indexOf('function changeRoomDraft ('))
  for (const field of ['name: room.name', 'bio: room.bio', 'link: room.link', 'avatar: room.avatar', 'abuseFilter: room.moderation', 'nsfwFilter: room.moderation', 'spamRateLimit: room.moderation']) {
    assert.ok(open.includes(field), field)
  }
  // iOS cannot show one sheet while another is still closing.
  assert.match(open, /replaceModal\(\(\) => setShowRoomInfo\(false\), \(\) => setRoomDraft\(draft\)\)/)
})

test('the edit sheet has the create sheet\'s picture, fields and moderation, and says who sees the change', () => {
  const sheet = screen.slice(screen.indexOf('visible={roomDraft !== null}'), screen.indexOf('{activeRoom.removedByCreator && ('))
  // The same picker and screening as the create sheet's picture.
  assert.match(sheet, /onPress=\{\(\) => chooseAvatar\(roomDraft\.avatar, \(avatar\) => changeRoomDraft\(\{ avatar \}\)\)\}/)
  assert.match(sheet, /placeholder=\{t\('Room name'\)\}/)
  assert.match(sheet, /placeholder=\{t\('Description \(optional\)'\)\}/)
  assert.match(sheet, /placeholder=\{t\('https:\/\/ link \(optional\)'\)\}/)
  assert.match(sheet, />\{t\('Abuse filter'\)\}</)
  assert.match(sheet, />\{t\('Profanity & slurs'\)\}</)
  assert.match(sheet, /changeRoomDraft\(\{ spamRateLimit: nextSpamRateLimit\(roomDraft\.spamRateLimit\) \}\)/)
  assert.match(sheet, /Everyone in the room sees the change\./)
  assert.match(sheet, /disabled=\{!roomDraft\.name\.trim\(\) \|\| isBusy\}\s+onPress=\{saveRoomDraft\}/)
  assert.match(screen, /function nextSpamRateLimit \(limit: number\) \{\s+return limit === 5 \? 10 : limit === 10 \? 15 : 5\s+\}/)
})

test('saving sends the whole room, and the header, Room info and list show it at once', () => {
  const save = screen.slice(screen.indexOf('function saveRoomDraft ('), screen.indexOf('function openHeaderDetails ('))
  assert.match(save, /callRpc\(RPC_PEERCHAT_ROOM_UPDATE, \{\s+roomKey: draft\.roomKey,\s+name: draft\.name,\s+bio: draft\.bio,\s+link: draft\.link,\s+avatar: draft\.avatar,\s+moderation: \{/)
  assert.match(save, /if \(activeRoomRef\.current\?\.roomKey === saved\.roomKey\) setActiveRoom\(saved\)/)
  assert.match(save, /if \(response\.rooms\) setRooms\(response\.rooms\)/)
  // A change from the creator's other device comes in with every refresh.
  assert.match(screen, /if \(response\.room\) setActiveRoom\(response\.room\)\s+if \(response\.rooms\) setRooms\(response\.rooms\)/)
})

test('the create sheet says the room can be changed later', () => {
  assert.match(screen, /You can change these later, and everyone in the room sees the change\./)
  assert.match(screen, /You can change these later too\./)
  assert.doesNotMatch(screen, /cannot be edited after creation|fixed once the group is created/)
})
