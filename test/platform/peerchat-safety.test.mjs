import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

// App Review's rule for apps where people post things: a way to report it, a
// way to block whoever posted it, and a block that takes their content out of
// view at once and tells the developer.
test('a message from someone else can be reported or its sender blocked, from the message itself', () => {
  const start = screen.indexOf('onPress={showMessageInfo}')
  const sheet = screen.slice(start, screen.indexOf('</Modal>', start))
  assert.match(sheet, /\{!messageActionTarget\.self && !messageActionTarget\.system && \(/)
  assert.match(sheet, /onPress=\{\(\) => reportMessage\(messageActionTarget\)\}/)
  assert.match(sheet, /onPress=\{\(\) => blockMessageSender\(messageActionTarget\)\}/)
  assert.match(screen, /void reportMember\(messageSender\(message\), activeRoom, message\)/)
})

test('every block asks first, and can report in the same tap', () => {
  const confirm = screen.slice(screen.indexOf('function confirmBlockPeer ('), screen.indexOf('async function blockMember'))
  assert.match(confirm, /You will not see anything they send, in any chat/)
  assert.match(confirm, /text: 'Block and report'/)
  assert.match(confirm, /void blockMember\(member\)\s+void reportMember\(member, from, message\)/)
  assert.doesNotMatch(screen, /onBlock=\{blockMember\}/)
  assert.equal((screen.match(/onBlock=\{\(member\) => confirmBlockPeer\(member\)\}/g) || []).length, 2)
})

test('someone blocked is not offered in Find people', () => {
  const directory = screen.slice(screen.indexOf('const directory = '), screen.indexOf('const myInviteUrl'))
  assert.match(directory, /!blockedPeers\.some\(\(blocked\) => blocked\.peerId === member\.id\)/)
})
