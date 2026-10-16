import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildPeerChatInviteUrl,
  parsePeerChatInvite,
  parsePeerChatRoomInvite,
  peerChatJoinRequest
} from '../../app/peerchat/peerchat-invite.mjs'
import { getRuntimeAppFromUrl, getRuntimeAppLaunchSuffix } from '../../app/internal-apps-registry.mjs'
import { checkCreatorProof } from '../../backend/peerchat/room-move.mjs'

// A room invite that says who made the room, so whoever joins from it knows
// from the start and does not take the first member who claims to have made
// it. Built from the shared creator vector in
// test/protocol/peerchat-room-move.test.mjs (creator seed 0x21). The desktop's
// invite tests pin the same link and the same result: if either app changes a
// byte of it, both fail.
const ROOM = '7fb72ca22e0efb0506a7402bf3d3a1548e2b7244b9ff2d8cb3fb3a063851d932'
const CREATOR = '884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b'
const PROOF = '00000000000000000000000000000000000000000000000000000000000172fd'
const LINK = 'peersky://p2p/peerchat/#room=7fb72ca22e0efb0506a7402bf3d3a1548e2b7244b9ff2d8cb3fb3a063851d932&creator=884b8857f4eaa1613c61504db34d4beaf346517a0e31de3cddd4d9b4201d9d0b&proof=00000000000000000000000000000000000000000000000000000000000172fd'

test('an invite that says who made the room is the same link in both apps', () => {
  assert.ok(checkCreatorProof(ROOM, CREATOR, PROOF))
  assert.equal(buildPeerChatInviteUrl(ROOM, CREATOR, PROOF), LINK)
  assert.deepEqual(parsePeerChatRoomInvite(LINK), { roomKey: ROOM, creatorKey: CREATOR, creatorProof: PROOF })
  // Whatever case it came in, it is written and read in lowercase.
  assert.equal(buildPeerChatInviteUrl(ROOM.toUpperCase(), CREATOR.toUpperCase(), PROOF.toUpperCase()), LINK)
  assert.deepEqual(
    parsePeerChatRoomInvite(`#room=${ROOM.toUpperCase()}&creator=${CREATOR.toUpperCase()}&proof=${PROOF.toUpperCase()}`),
    { roomKey: ROOM, creatorKey: CREATOR, creatorProof: PROOF }
  )
})

test('an older build, and everything that only needs the room, still reads the room alone', () => {
  assert.equal(parsePeerChatInvite(LINK), ROOM)
  // What an older build does with the fragment.
  assert.equal(new URLSearchParams(LINK.slice(LINK.indexOf('#') + 1)).get('room'), ROOM)
  // The browser shell hands PeerChat the fragment, and it comes back whole.
  assert.equal(getRuntimeAppFromUrl(LINK), 'peerchat')
  assert.deepEqual(parsePeerChatRoomInvite(getRuntimeAppLaunchSuffix(LINK)), { roomKey: ROOM, creatorKey: CREATOR, creatorProof: PROOF })
})

test('the creator only when whole, and the secret only with it', () => {
  const room = `#room=${ROOM}`
  // No creator: the room alone, as every invite before this.
  assert.equal(buildPeerChatInviteUrl(ROOM), `peersky://p2p/peerchat/${room}`)
  assert.deepEqual(parsePeerChatRoomInvite(ROOM), { roomKey: ROOM, creatorKey: '', creatorProof: '' })
  assert.deepEqual(parsePeerChatRoomInvite(room), { roomKey: ROOM, creatorKey: '', creatorProof: '' })
  // A creator without a secret is a room made before secrets, or one whose
  // secret the inviting device does not hold.
  assert.equal(buildPeerChatInviteUrl(ROOM, CREATOR), `peersky://p2p/peerchat/${room}&creator=${CREATOR}`)
  assert.deepEqual(parsePeerChatRoomInvite(`${room}&creator=${CREATOR}`), { roomKey: ROOM, creatorKey: CREATOR, creatorProof: '' })
  // A secret goes nowhere without a creator.
  assert.equal(buildPeerChatInviteUrl(ROOM, '', PROOF), `peersky://p2p/peerchat/${room}`)
  assert.deepEqual(parsePeerChatRoomInvite(`${room}&proof=${PROOF}`), { roomKey: ROOM, creatorKey: '', creatorProof: '' })
  // Anything short of 64 hex is not a creator.
  assert.equal(buildPeerChatInviteUrl(ROOM, CREATOR.slice(1), PROOF), `peersky://p2p/peerchat/${room}`)
  assert.deepEqual(parsePeerChatRoomInvite(`${room}&creator=${CREATOR.slice(1)}`), { roomKey: ROOM, creatorKey: '', creatorProof: '' })
  // A secret that is there but cannot be one takes the creator with it, as
  // if the link had neither.
  for (const proof of ['', 'nope', PROOF.slice(2), `${PROOF}00`]) {
    assert.deepEqual(parsePeerChatRoomInvite(`${room}&creator=${CREATOR}&proof=${proof}`), { roomKey: ROOM, creatorKey: '', creatorProof: '' }, proof)
  }
  // No room, no invite, whatever else it says.
  for (const bad of ['', 'peersky://p2p/peerchat/', `#creator=${CREATOR}&proof=${PROOF}`, `#room=${ROOM.slice(1)}&creator=${CREATOR}`, `#dm=${CREATOR}`, null]) {
    assert.equal(parsePeerChatRoomInvite(bad), null, String(bad))
  }
})

test('joining asks PeerChat for the room and who made it, as the invite says', () => {
  assert.deepEqual(peerChatJoinRequest(LINK), { roomKey: ROOM, creatorKey: CREATOR, creatorProof: PROOF })
  assert.deepEqual(peerChatJoinRequest(`  ${ROOM}  `), { roomKey: ROOM })
  assert.deepEqual(peerChatJoinRequest(`#room=${ROOM}&creator=${CREATOR}`), { roomKey: ROOM, creatorKey: CREATOR })
  // Anything else goes as typed, for PeerChat to refuse in its own words.
  assert.deepEqual(peerChatJoinRequest(' not a key '), { roomKey: 'not a key' })
})

// Every way an invite is made or opened on the phone: Share, Copy invite link,
// the Join box, a scanned code and a link tapped anywhere on the phone.
test('every way into a room carries who made it', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const shell = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

  const share = screen.slice(screen.indexOf('async function shareRoom ()'), screen.indexOf('async function inviteFriends ()'))
  assert.match(share, /buildPeerChatInviteUrl\(activeRoom\.roomKey, activeRoom\.creatorKey, activeRoom\.creatorProof\)/)
  assert.match(screen, /Clipboard\.setString\(buildPeerChatInviteUrl\(roomActionTarget\.roomKey, roomActionTarget\.creatorKey, roomActionTarget\.creatorProof\)\)/)

  const joinByKey = screen.slice(screen.indexOf('async function joinRoomByKey ('), screen.indexOf('function directMessagePeer ('))
  assert.match(joinByKey, /callRpc\(RPC_PEERCHAT_ROOM_JOIN, peerChatJoinRequest\(invite\)\)/)
  const joinBox = screen.slice(screen.indexOf('function joinRoom ()'), screen.indexOf('function showRoomActions ('))
  assert.match(joinBox, /callRpc\(RPC_PEERCHAT_ROOM_JOIN, peerChatJoinRequest\(joinKey\)\)/)
  // The box takes a whole link, not just 64 characters, and Join waits for
  // something that names a room.
  assert.doesNotMatch(screen, /maxLength=\{64\}/)
  assert.match(screen, /disabled=\{!profileName\.trim\(\) \|\| !parsePeerChatInvite\(joinKey\) \|\| isBusy\}/)

  const scan = screen.slice(screen.indexOf('inviteScanHandledRef.current = true'), screen.indexOf('function joinRoom ('))
  assert.match(scan, /void joinRoomByKey\(value\)/)

  // A tapped link reaches the screen whole, and a room already here still
  // takes who made it.
  assert.match(shell, /setRequestedPeerChatRoomKey\(buildPeerChatInviteUrl\(invitedRoom, invite\?\.creatorKey, invite\?\.creatorProof\)\)/)
  const effect = screen.slice(
    screen.indexOf('if (!requestedRoomKey || !isInitialized'),
    screen.indexOf('[isInitialized, onRequestedRoomHandled, profile?.username, requestedRoomKey, rooms]')
  )
  assert.match(effect, /const invite = parsePeerChatRoomInvite\(requestedRoomKey\)/)
  assert.match(effect, /if \(invite\?\.creatorKey\) void callRpcRef\.current\(RPC_PEERCHAT_ROOM_JOIN, peerChatJoinRequest\(requestedRoomKey\)\)/)
})
