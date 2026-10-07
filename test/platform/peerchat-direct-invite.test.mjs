import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildPeerChatDirectInviteUrl,
  buildPeerChatInviteUrl,
  isPeerChatDirectRoomFor,
  parsePeerChatDirectInvite,
  parsePeerChatInvite,
  splitPeerChatDirectPeer
} from '../../app/peerchat/peerchat-invite.mjs'
import {
  getRuntimeAppFromUrl,
  getRuntimeAppLaunchSuffix
} from '../../app/internal-apps-registry.mjs'

const PEER = 'a1b2c3d4'
const KEY = `${PEER}${'5e'.repeat(28)}`
const ROOM = 'ab'.repeat(32)

// A personal invite says who to ask, not how to get in. The person on the other
// end still accepts, declines or blocks, which is what makes it safe to put on
// a screen for a stranger to scan.
test('a personal invite carries the whole key and round-trips', () => {
  const url = buildPeerChatDirectInviteUrl(KEY)
  assert.equal(url, `peersky://p2p/peerchat/#dm=${KEY}`)
  assert.equal(parsePeerChatDirectInvite(url), KEY)
  assert.equal(parsePeerChatDirectInvite(`#dm=${KEY.toUpperCase()}`), KEY)
  assert.equal(buildPeerChatDirectInviteUrl(KEY.toUpperCase()), url)
})

// Links already shared carry the short id. They keep working.
test('an older link with only the short id still opens', () => {
  assert.equal(parsePeerChatDirectInvite(`peersky://p2p/peerchat/#dm=${PEER}`), PEER)
  assert.equal(parsePeerChatDirectInvite(`#dm=${PEER.toUpperCase()}`), PEER)
  assert.equal(parsePeerChatDirectInvite(PEER), PEER)
})

test('only a whole key makes a link', () => {
  assert.equal(buildPeerChatDirectInviteUrl(PEER), '')
  assert.equal(buildPeerChatDirectInviteUrl('nothex!!'), '')
  assert.equal(buildPeerChatDirectInviteUrl(`${KEY}0`), '')
  assert.equal(buildPeerChatDirectInviteUrl(''), '')
  assert.equal(buildPeerChatDirectInviteUrl(null), '')
})

test('a link is read as the short id everything shows and the key behind it', () => {
  assert.deepEqual(splitPeerChatDirectPeer(KEY.toUpperCase()), { id: PEER, key: KEY })
  assert.deepEqual(splitPeerChatDirectPeer(PEER), { id: PEER, key: '' })
  assert.deepEqual(splitPeerChatDirectPeer('nothex!!'), { id: '', key: '' })
  assert.deepEqual(splitPeerChatDirectPeer(null), { id: '', key: '' })
})

// A link opens the conversation already there, unless that one is with
// someone else whose key starts the same way.
test('a link opens only the conversation with the key it names', () => {
  const bound = { isDM: true, dmWith: PEER, dmWithKey: KEY, pendingAcceptance: false }
  const other = { ...bound, dmWithKey: `${PEER}${'77'.repeat(28)}` }
  const waiting = { isDM: true, dmWith: PEER, dmWithKey: null, pendingAcceptance: true }
  const older = { isDM: true, dmWith: PEER, pendingAcceptance: false }

  assert.equal(isPeerChatDirectRoomFor(bound, KEY), true)
  assert.equal(isPeerChatDirectRoomFor(other, KEY), false)
  // A request that went to no key yet is asked again, to this one.
  assert.equal(isPeerChatDirectRoomFor(waiting, KEY), false)
  // A conversation from before keys were kept is the one with that id.
  assert.equal(isPeerChatDirectRoomFor(older, KEY), true)
  // An older link only has the id to go by.
  for (const room of [bound, other, waiting, older]) assert.equal(isPeerChatDirectRoomFor(room, PEER), true)
  assert.equal(isPeerChatDirectRoomFor({ ...bound, isDM: false }, KEY), false)
  assert.equal(isPeerChatDirectRoomFor({ ...bound, dmWith: 'ffffffff' }, KEY), false)
})

test('nonsense parses to nothing', () => {
  assert.equal(parsePeerChatDirectInvite('peersky://p2p/peerchat/'), '')
  assert.equal(parsePeerChatDirectInvite('#dm=nothex!!'), '')
  assert.equal(parsePeerChatDirectInvite(''), '')
  assert.equal(parsePeerChatDirectInvite(null), '')
})

// The two kinds of link have to stay apart: a room key is a capability and a
// person's key is not, so neither may be read as the other.
test('a room link is not a person and a person is not a room', () => {
  const roomUrl = buildPeerChatInviteUrl(ROOM)
  const personUrl = buildPeerChatDirectInviteUrl(KEY)

  assert.equal(parsePeerChatDirectInvite(roomUrl), '')
  assert.equal(parsePeerChatInvite(personUrl), '')
  assert.equal(parsePeerChatInvite(roomUrl), ROOM)
  assert.equal(parsePeerChatDirectInvite(personUrl), KEY)
  // Both are 64 hex, so a bare one is the room QR it always was.
  assert.equal(parsePeerChatDirectInvite(ROOM), '')
  assert.equal(parsePeerChatInvite(ROOM), ROOM)
})

// The window itself: your own code to hand out, and the one room everybody is
// in doubling as the place to look somebody up.
test('find people offers your code and the welcome room as the directory', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  assert.match(screen, /const myInviteUrl = buildPeerChatDirectInviteUrl\(profile\?\.key \|\| ''\)/)
  assert.match(screen, /<QrCodeView value=\{myInviteUrl\} size=\{190\} \/>/)
  // The directory is the welcome room's own member list, not a service.
  assert.match(screen, /rooms\.find\(\(room\) => room\.roomKey === PRE_JOINED_PEERCHAT_ROOM_KEY\)\?\.members/)
  assert.match(screen, /No directory/)
  // You are not in your own search results, and nor is anyone you blocked.
  assert.match(screen, /\.filter\(\(member\) => !member\.self && !blockedPeers\.some/)
})

test('a scanned code asks rather than joins, and both kinds of code work', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  const scan = screen.slice(screen.indexOf('inviteScanHandledRef.current = true'), screen.indexOf('function joinRoom ('))
  // The personal one is tried first, then the room one, so a camera pointed at
  // either does the right thing.
  assert.ok(scan.indexOf('parsePeerChatDirectInvite(value)') < scan.indexOf('parsePeerChatInvite(value)'))
  assert.match(scan, /void requestDirectMessage\(peer\)/)

  // Your own code does nothing rather than opening a chat with yourself.
  const request = screen.slice(screen.indexOf('async function requestDirectMessage ('), screen.indexOf('function openDiscover ('))
  assert.match(request, /peerId === profile\?\.id/)
  assert.match(request, /That is your own code/)
  // The request goes to the key the code names.
  assert.match(request, /const \{ id: peerId, key: peerKey \} = splitPeerChatDirectPeer\(peer\)/)
  assert.match(request, /peerId,\s+peerKey,/)
  // And a link opens a conversation already there only if it is with that key.
  assert.match(screen, /const existing = rooms\.find\(\(room\) => isPeerChatDirectRoomFor\(room, requestedPeerId\)\)/)
  // And it waits for a name, exactly like a room invite does.
  assert.match(screen, /if \(!requestedPeerId \|\| !isInitialized \|\| !profile\?\.username\) return/)
})

// Somebody points their phone camera at a profile code and has never opened
// PeerSky before. The whole chain: the operating system hands the link over,
// it names PeerChat, the fragment survives, and the key comes back out.
test('a code scanned with the phone camera reaches PeerChat as a person', () => {
  const url = buildPeerChatDirectInviteUrl(KEY)

  assert.equal(getRuntimeAppFromUrl(url), 'peerchat')
  const suffix = getRuntimeAppLaunchSuffix(url)
  assert.equal(suffix, `#dm=${KEY}`)
  assert.equal(parsePeerChatDirectInvite(suffix), KEY)
  // And it is not mistaken for a room to walk into.
  assert.equal(parsePeerChatInvite(suffix), '')
})

test('a room code scanned the same way still opens the room', () => {
  const url = buildPeerChatInviteUrl(ROOM)

  assert.equal(getRuntimeAppFromUrl(url), 'peerchat')
  assert.equal(parsePeerChatInvite(getRuntimeAppLaunchSuffix(url)), ROOM)
})

// A brand new install has no name yet, so both kinds of link wait for the
// welcome screen instead of being thrown away at the door.
test('either kind of link waits for a name rather than being dropped', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  assert.match(screen, /if \(!requestedPeerId \|\| !isInitialized \|\| !profile\?\.username\) return/)
  assert.match(screen, /if \(!requestedRoomKey \|\| !isInitialized \|\| !profile\?\.username\) return/)
})
