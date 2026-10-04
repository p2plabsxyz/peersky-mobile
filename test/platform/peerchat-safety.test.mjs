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

// Making a profile in the app means being able to delete it in the app.
test('a PeerChat profile can be deleted from PeerChat settings', async () => {
  const commands = await import('../../backend/rpc/commands.mjs')
  assert.equal(commands.RPC_PEERCHAT_DELETE_PROFILE, 73)
  const values = Object.entries(commands)
    .filter(([name]) => name.startsWith('RPC_') && !name.startsWith('RPC_APP_'))
    .map(([, value]) => value)
  assert.equal(new Set(values).size, values.length, 'every command number is its own')

  const router = await readFile(new URL('../../backend/rpc/router.mjs', import.meta.url), 'utf8')
  assert.match(router, /req\.command === RPC_PEERCHAT_DELETE_PROFILE\) \{\s+replyJson\(req, await deletePeerChatProfile\(\)\)/)

  assert.match(screen, /onPress=\{confirmDeleteProfile\}/)
  assert.match(screen, />Delete PeerChat profile</)
  const confirm = screen.slice(screen.indexOf('function confirmDeleteProfile'), screen.indexOf('async function deleteProfile'))
  assert.match(confirm, /This cannot be undone/)
  assert.match(confirm, /style: 'destructive', onPress: \(\) => void deleteProfile\(\)/)
})

// A poll that read the room just before a send landed just after it, and took
// the message off the screen until the next poll. The refresh the send asked
// for was skipped because that poll was still running.
test('a sent message is not taken back off the screen by an older poll', () => {
  const refresh = screen.slice(screen.indexOf('const refreshRoom = useCallback'), screen.indexOf('const refreshRoomRef = useRef(refreshRoom)'))
  assert.match(refresh, /if \(pollInFlightRef\.current\) \{\s+refreshAgainRef\.current = refreshAgainRef\.current \|\| force \|\| 'poll'/)
  assert.match(refresh, /const stale = sentCountRef\.current !== sentBefore/)
  assert.match(refresh, /if \(Array\.isArray\(response\.messages\) && !stale\)/)
  assert.match(refresh, /if \(again && mountedRef\.current\) void refreshRoomRef\.current\(again === true\)/)
  assert.match(screen, /sentCountRef\.current \+= 1\s+setMessages\(\(current\) => current\.some\(\(item\) => item\.id === response\.sent\?\.id\)/)
})
