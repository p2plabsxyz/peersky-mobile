import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildPeerChatAppInviteMessage, buildPeerChatDirectInviteUrl } from '../../app/peerchat/peerchat-invite.mjs'

test('Find invites friends to install PeerChat, with your own link to message you once they are set up', async () => {
  const install = "I'm inviting you to install PeerChat! Here is the link:\nhttps://peersky.p2plabs.xyz/mobile"
  const mine = buildPeerChatDirectInviteUrl('1a2b3c4d')
  assert.equal(
    buildPeerChatAppInviteMessage(mine),
    `${install}\n\nThen open this link to message me:\npeersky://p2p/peerchat/#dm=1a2b3c4d`
  )
  // No name yet, so no link of your own: the install link alone.
  assert.equal(buildPeerChatAppInviteMessage(''), install)
  assert.equal(buildPeerChatAppInviteMessage('https://example.com/'), install)

  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  // Under the search bar, before anyone it finds.
  const searchBar = screen.indexOf("placeholder='Search by name'")
  const invite = screen.indexOf('>Invite friends to PeerChat</Text>')
  const results = screen.indexOf('{directory.map((member) => (')
  assert.ok(searchBar > 0 && searchBar < invite && invite < results)
  assert.match(screen, /await shareLink\(\{ title: 'Invite friends to PeerChat', message: buildPeerChatAppInviteMessage\(myInviteUrl\) \}\)/)
  assert.match(screen, /const myInviteUrl = buildPeerChatDirectInviteUrl\(profile\?\.id \|\| ''\)/)
})
