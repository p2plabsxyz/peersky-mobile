import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildPeerChatDirectInviteUrl,
  buildPeerChatInviteUrl,
  parsePeerChatDirectInvite,
  parsePeerChatInvite
} from '../../app/peerchat/peerchat-invite.mjs'
import {
  getRuntimeAppFromUrl,
  getRuntimeAppLaunchSuffix
} from '../../app/internal-apps-registry.mjs'

const PEER = 'a1b2c3d4'
const ROOM = 'ab'.repeat(32)

// A personal invite says who to ask, not how to get in. The person on the other
// end still accepts, declines or blocks, which is what makes it safe to put on
// a screen for a stranger to scan.
test('a personal invite round-trips', () => {
  const url = buildPeerChatDirectInviteUrl(PEER)
  assert.equal(url, `peersky://p2p/peerchat/#dm=${PEER}`)
  assert.equal(parsePeerChatDirectInvite(url), PEER)
  assert.equal(parsePeerChatDirectInvite(`#dm=${PEER.toUpperCase()}`), PEER)
  assert.equal(parsePeerChatDirectInvite(PEER), PEER)
})

test('only an 8 character peer id makes a link', () => {
  assert.equal(buildPeerChatDirectInviteUrl('nothex!!'), '')
  assert.equal(buildPeerChatDirectInviteUrl(ROOM), '')
  assert.equal(buildPeerChatDirectInviteUrl(''), '')
  assert.equal(buildPeerChatDirectInviteUrl(null), '')
})

test('nonsense parses to nothing', () => {
  assert.equal(parsePeerChatDirectInvite('peersky://p2p/peerchat/'), '')
  assert.equal(parsePeerChatDirectInvite('#dm=nothex!!'), '')
  assert.equal(parsePeerChatDirectInvite(''), '')
  assert.equal(parsePeerChatDirectInvite(null), '')
})

// The two kinds of link have to stay apart: a room key is a capability and a
// peer id is not, so neither may be read as the other.
test('a room link is not a person and a person is not a room', () => {
  const roomUrl = buildPeerChatInviteUrl(ROOM)
  const personUrl = buildPeerChatDirectInviteUrl(PEER)

  assert.equal(parsePeerChatDirectInvite(roomUrl), '')
  assert.equal(parsePeerChatInvite(personUrl), '')
  assert.equal(parsePeerChatInvite(roomUrl), ROOM)
  assert.equal(parsePeerChatDirectInvite(personUrl), PEER)
})

// The window itself: your own code to hand out, and the one room everybody is
// in doubling as the place to look somebody up.
test('find people offers your code and the welcome room as the directory', async () => {
  const { readFile } = await import('node:fs/promises')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  assert.match(screen, /const myInviteUrl = buildPeerChatDirectInviteUrl\(profile\?\.id \|\| ''\)/)
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
  assert.match(scan, /void requestDirectMessage\(peerId\)/)

  // Your own code does nothing rather than opening a chat with yourself.
  const request = screen.slice(screen.indexOf('async function requestDirectMessage ('), screen.indexOf('function openDiscover ('))
  assert.match(request, /peerId === profile\?\.id/)
  assert.match(request, /That is your own code/)
  // And it waits for a name, exactly like a room invite does.
  assert.match(screen, /if \(!requestedPeerId \|\| !isInitialized \|\| !profile\?\.username\) return/)
})

// Somebody points their phone camera at a profile code and has never opened
// PeerSky before. The whole chain: the operating system hands the link over,
// it names PeerChat, the fragment survives, and the peer id comes back out.
test('a code scanned with the phone camera reaches PeerChat as a person', () => {
  const url = buildPeerChatDirectInviteUrl(PEER)

  assert.equal(getRuntimeAppFromUrl(url), 'peerchat')
  const suffix = getRuntimeAppLaunchSuffix(url)
  assert.equal(suffix, `#dm=${PEER}`)
  assert.equal(parsePeerChatDirectInvite(suffix), PEER)
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
