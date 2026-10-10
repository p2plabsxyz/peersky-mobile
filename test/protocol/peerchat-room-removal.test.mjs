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

test('a removal list counts signed by the creator from anyone, or unsigned from the creator alone', () => {
  const receive = service.slice(
    service.indexOf('receiveRoomBans (roomKey, peer, bans, signedValue)'),
    service.indexOf('enforceRoomBans (roomKey)')
  )
  // Signed, whoever passed it on: the signature says it is the creator's.
  assert.match(receive, /if \(signed\.sig && checkSignedRemovals\(\{ topic: wireTopic\(roomKey\), creatorKey, bans, signed \}\)\) \{\s+if \(signed\.v <= held\.v\) return/)
  // Unsigned, from an older build: the connection has to be the creator's.
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

// A removal stops one room, and a connection carries every room two people
// share. Dropping it took them offline everywhere the two of you met, and threw
// away the removal notice still queued on it, so they never learned why.
test('a removed peer is cut out of the room, not off the connection', () => {
  const relay = service.slice(service.indexOf('relayToRoom (roomKey, message)'), service.indexOf('sendToPeer (peer, message)'))
  assert.match(relay, /if \(this\.isPeerRemovedFromRoom\(roomKey, peer\)\) continue/)

  const share = service.slice(service.indexOf('shareRoom (peer, roomKey)'), service.indexOf('announceRoom (roomKey)'))
  // The creator key comes first, because a removal is only believed from the
  // connection whose key that is. The other way round the list arrived with
  // nothing to check it against, so leaving and rejoining reopened the room.
  assert.ok(share.indexOf('this.sendRoomMeta(peer, roomKey)') < share.indexOf('this.sendRoomBans(peer, roomKey)'))
  assert.match(share, /if \(this\.isPeerRemovedFromRoom\(roomKey, peer\)\) return/)

  // Out of the room is out of its history too.
  const sync = service.slice(service.indexOf('async syncHistoryToPeer ('), service.indexOf('async syncHistoryToPeerOnce ('))
  assert.match(sync, /if \(this\.isPeerRemovedFromRoom\(roomKey, peer\)\) return false/)

  // And nothing takes the connection down over a room ban.
  assert.doesNotMatch(service, /dropRemovedPeer/)
  assert.doesNotMatch(service, /enforceRoomBans/)
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
  assert.match(service, /async appendRemovalNotice \(roomKey, peerId, username, at = Date\.now\(\)\)/)
  // By name: "the creator" tells nobody in the room who that was.
  assert.match(service, /was removed from the room by \$\{by\}/)
  assert.match(service, /room\?\.createdByName \|\| room\?\.createdBy \|\| 'whoever made the room'/)

  // The creator says it when they do it.
  const remove = service.slice(service.indexOf('async removeRoomMember ('), service.indexOf('async restoreRoomMember ('))
  assert.match(remove, /await this\.appendRemovalNotice\(normalized, id, name\)/)

  // And everyone else says it when the removal reaches them, for bans that
  // are new to them and made since they joined, rather than for the whole
  // list every time, or for removals from before a newcomer was there.
  const receive = service.slice(service.indexOf('receiveRoomBans (roomKey, peer, bans, signedValue)'), service.indexOf('enforceRoomBans (roomKey)'))
  assert.match(receive, /const before = new Set\(/)
  assert.match(receive, /const since = room\.joinedAt \|\| Date\.now\(\)/)
  assert.match(receive, /if \(before\.has\(ban\.id\) \|\| !\(ban\.at > since\)\) continue/)
  assert.match(receive, /this\.appendRemovalNotice\(roomKey, ban\.id, ban\.name, ban\.at\)/)
})

test('a removal says who it was by the name the creator gave', () => {
  const remove = service.slice(service.indexOf('async removeRoomMember ('), service.indexOf('async restoreRoomMember ('))
  assert.match(remove, /addPeerChatRoomBan\(room\.bans, \{ id, key: connected\?\.key \|\| '', name \}\)/)
  const receive = service.slice(service.indexOf('receiveRoomBans (roomKey, peer, bans, signedValue)'), service.indexOf('enforceRoomBans (roomKey)'))
  assert.match(receive, /this\.appendRemovalNotice\(roomKey, ban\.id, ban\.name, ban\.at\)/)
})

test('a removed person cannot get back in through somebody else s history', () => {
  const author = service.slice(service.indexOf('  authorOf ('), service.indexOf('  arrivesInTime ('))
  // Signed, a removed author's message is refused whoever brings it.
  assert.match(author, /this\.isAuthorRemoved\(roomKey, signed\.authorId, signed\.author\)/)
  // Unsigned, somebody else's history cannot name an author at all.
  assert.match(author, /if \(via === 'sync' && message\.sender !== peer\.id\) return null/)

  // Before the message is tracked, or a second copy of it would be dropped as
  // a duplicate rather than refused.
  const receive = service.slice(service.indexOf('  async receiveChatMessage ('), service.indexOf('  passOn ('))
  const guard = receive.indexOf('this.authorOf(')
  const track = receive.indexOf('this.takeMessageId(roomKey, message.id, via)')
  assert.ok(guard > -1 && track > -1 && guard < track)
})

test('letting somebody back in puts them back in the list', () => {
  const receive = service.slice(service.indexOf('receiveRoomBans (roomKey, peer, bans, signedValue)'), service.indexOf('enforceRoomBans (roomKey)'))
  assert.match(receive, /room\.members = \(room\.members \|\| \[\]\)\.filter/)
})
