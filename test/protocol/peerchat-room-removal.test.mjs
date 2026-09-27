import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const service = await readFile(new URL('../../backend/peerchat/service.mjs', import.meta.url), 'utf8')
const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

// There is no server, so a removal is only ever what honest clients agree to
// do. What keeps it from being a free-for-all is that the handshake already
// said who is on the other end of the connection.

test('a peer carries the full key the handshake established', () => {
  assert.match(service, /key: connection\.remotePublicKey\n\s+\? b4a\.toString\(connection\.remotePublicKey, 'hex'\)\.toLowerCase\(\)/)
  assert.match(service, /this\.localKey = sdk\.publicKey \? b4a\.toString\(sdk\.publicKey, 'hex'\)\.toLowerCase\(\) : ''/)
})

test('a new room records who made it by whole key, not by eight characters', () => {
  const create = service.slice(service.indexOf('async createRoom ('), service.indexOf('async joinRoom ('))
  assert.match(create, /creatorKey: this\.localKey/)
  assert.match(create, /bans: \[\]/)
})

test('a removal list is taken from the creator and nobody else', () => {
  const receive = service.slice(
    service.indexOf('receiveRoomBans (roomKey, peer, bans)'),
    service.indexOf('enforceRoomBans (roomKey)')
  )
  assert.match(receive, /isPeerChatRoomCreator\(\{/)
  assert.match(receive, /connectionKey: peer\.key/)
  // Their list replaces ours outright: they are the record.
  assert.match(receive, /room\.bans = normalizePeerChatRoomBans\(bans\)/)
})

test('the creator key is only taken from the creator either', () => {
  assert.match(service, /acceptsPeerChatCreatorKey\(\{[\s\S]{0,200}connectionKey: peer\.key/)
})

test('nothing a removed peer sends counts, including a removal list', () => {
  const handler = service.slice(service.indexOf('async handlePeerMessage ('))
  const banCheck = handler.indexOf('this.isPeerRemovedFromRoom(roomKey, peer)')
  const banHandler = handler.indexOf("message.type === 'room-bans'")
  assert.ok(banCheck > -1 && banHandler > -1)
  assert.ok(banCheck < banHandler, 'the check has to sit above every handler')
})

test('a removed peer is dropped, not relayed to', () => {
  const relay = service.slice(service.indexOf('relayToRoom (roomKey, message)'), service.indexOf('sendToPeer (peer, message)'))
  assert.match(relay, /if \(this\.isPeerRemovedFromRoom\(roomKey, peer\)\) continue/)

  const share = service.slice(service.indexOf('shareRoom (peer, roomKey)'), service.indexOf('announceRoom (roomKey)'))
  // Told before anything else, so the one who was removed finds out.
  assert.ok(share.indexOf('this.sendRoomBans(peer, roomKey)') < share.indexOf('this.sendRoomMeta(peer, roomKey)'))
  assert.match(share, /this\.disconnectPeer\(peer\)/)
})

test('only the creator can remove, and not themselves', () => {
  const remove = service.slice(
    service.indexOf('async removeRoomMember ('),
    service.indexOf('async restoreRoomMember (')
  )
  assert.match(remove, /if \(!this\.isRoomCreator\(normalized\)\)/)
  assert.match(remove, /cannot remove yourself/)
  assert.match(remove, /There is nobody to remove from a direct message/)
  // Their whole key when they are here to take it from, so the removal catches
  // that person and not everyone sharing their first eight characters.
  assert.match(remove, /key: connected\?\.key \|\| ''/)
})

test('a removal outlives a restart', () => {
  assert.match(service, /bans: isDM \? \[\] : normalizePeerChatRoomBans\(value\?\.bans\)/)
  assert.match(service, /creatorKey: normalizePeerChatCreatorKey\(value\?\.creatorKey\)/)
})

test('the app is told whose room it is and whether it was removed', () => {
  assert.match(service, /isCreator: this\.isRoomCreator\(room\.roomKey\)/)
  assert.match(service, /removedByCreator: this\.isRemovedFromRoom\(room\.roomKey\)/)
  // The key itself never reaches the app. Nothing on screen needs it, and the
  // one thing that did was copying it out to pin, which is done.
  assert.doesNotMatch(service, /creatorKey: resolvePeerChatCreatorKey/)
})

test('the room screen offers removing only to whoever made the room', () => {
  assert.match(screen, /activeRoom\.isCreator && !member\.self/)
  // And it says what it means before doing it.
  assert.match(screen, /will not be able to come back to this room/)
})

test('somebody removed is told, and their composer says so', () => {
  assert.match(screen, /You were removed from this room by/)
  assert.match(screen, /const isRemovedFromRoom = activeRoom\?\.removedByCreator === true/)
  assert.match(screen, /isDirectMessageBlocked \|\| isRemovedFromRoom/)
})

// P2P Republic was made long before any of this, so its record carries no
// creator key. The one device that can say what it is, is the one that made it.
test('a room made before this fills its creator key in on the host device', () => {
  assert.match(
    service,
    /creatorKey: normalizePeerChatCreatorKey\(value\?\.creatorKey\) \|\|\n\s+\(value\?\.isHost === true && !isDM \? this\.localKey : ''\)/
  )
})

// The key belongs to the room you made, not to every room you are in. Putting
// it on the join path instead would have had everyone who joined a room
// believing they created it.
test('the creator key is recorded when a room is made and nowhere else', () => {
  const create = service.slice(service.indexOf('async createRoom ('), service.indexOf('async joinRoom ('))
  assert.match(create, /isHost: true/)
  assert.match(create, /creatorKey: this\.localKey/)

  // Every other assignment is either the room-meta announcement, which is
  // guarded by the connection, or reading one back.
  const assignments = [...service.matchAll(/creatorKey: this\.localKey/g)]
  assert.equal(assignments.length, 1, 'only the room being created gets it')
  assert.match(service, /creatorKey: room\.isHost \? this\.localKey : ''/)
})

// P2P Republic predates all of this and its own record names a device whose
// storage is long gone, so nothing announced over the network could settle who
// moderates it. The pin does, and nothing can argue with it.
test('P2P Republic has a creator key pinned in the source', async () => {
  const { PRE_JOINED_PEERCHAT_ROOM_KEY } = await import('../../backend/peerchat/rooms.mjs')
  const {
    acceptsPeerChatCreatorKey,
    isPeerChatRoomCreator,
    resolvePeerChatCreatorKey
  } = await import('../../backend/peerchat/room-moderation.mjs')

  const pinned = resolvePeerChatCreatorKey(PRE_JOINED_PEERCHAT_ROOM_KEY, '')
  assert.match(pinned, /^[a-f0-9]{64}$/)

  // Nothing stored locally and nothing announced can move it.
  assert.equal(resolvePeerChatCreatorKey(PRE_JOINED_PEERCHAT_ROOM_KEY, 'ff'.repeat(32)), pinned)
  assert.equal(
    acceptsPeerChatCreatorKey({
      roomKey: PRE_JOINED_PEERCHAT_ROOM_KEY,
      storedKey: '',
      createdBy: '',
      announcedKey: 'ab'.repeat(32),
      connectionKey: 'ab'.repeat(32)
    }),
    false
  )
  assert.equal(
    isPeerChatRoomCreator({
      roomKey: PRE_JOINED_PEERCHAT_ROOM_KEY,
      storedKey: '',
      connectionKey: pinned
    }),
    true
  )
})

// Three things went wrong the first time this shipped, and all three are about
// a removal being a fact the room keeps rather than one delete.
test('a removed member is filtered out of the list, not just deleted once', () => {
  const list = service.slice(service.indexOf('listRoomMembers (roomKey)'), service.indexOf('peerJoinedAt ('))

  // The list is rebuilt from what peers relay, so deleting the stored entry
  // only lasted until the next member list arrived from somebody else.
  assert.match(list, /if \(this\.isPeerIdRemovedFromRoom\(roomKey, id\)\) members\.delete\(id\)/)
  assert.match(list, /if \(member\.self\) continue/)
})

test('a removal is said out loud in the room, by everyone who honours it', () => {
  assert.match(service, /async appendRemovalNotice \(roomKey, peerId, username\)/)
  assert.match(service, /was removed from the room by its creator/)

  // The creator says it when they do it.
  const remove = service.slice(service.indexOf('async removeRoomMember ('), service.indexOf('async restoreRoomMember ('))
  assert.match(remove, /await this\.appendRemovalNotice\(normalized, id, name\)/)

  // And everyone else says it when the removal reaches them, for bans that
  // are new to them rather than for the whole list every time.
  const receive = service.slice(service.indexOf('receiveRoomBans (roomKey, peer, bans)'), service.indexOf('enforceRoomBans (roomKey)'))
  assert.match(receive, /const before = new Set\(/)
  assert.match(receive, /if \(before\.has\(ban\.id\)\) continue/)
  assert.match(receive, /this\.appendRemovalNotice\(roomKey, ban\.id, ''\)/)
})

test('a removed person cannot get back in through somebody else s history', () => {
  const handler = service.slice(service.indexOf('async handlePeerMessage ('))
  assert.match(handler, /if \(isSync && this\.isPeerIdRemovedFromRoom\(roomKey, normalizePeerChatPeerId\(message\.sender\)\)\) return/)

  // Before the message is tracked, or a second copy of it would be dropped as
  // a duplicate rather than refused.
  const guard = handler.indexOf('isSync && this.isPeerIdRemovedFromRoom')
  const track = handler.indexOf('!this.trackMessageId(message.id)')
  assert.ok(guard > -1 && track > -1 && guard < track)
})

test('letting somebody back in puts them back in the list', () => {
  const receive = service.slice(service.indexOf('receiveRoomBans (roomKey, peer, bans)'), service.indexOf('enforceRoomBans (roomKey)'))
  assert.match(receive, /room\.members = \(room\.members \|\| \[\]\)\.filter/)
})
