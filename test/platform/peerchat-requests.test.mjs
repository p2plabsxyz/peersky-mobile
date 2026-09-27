import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

// Requests used to sit open above the chat list and push it down, so with more
// than one or two the chats you actually use went off the bottom.
test('requests are a line of text, not a list in the way', () => {
  assert.match(screen, /Requests \(\{pendingDirectMessages\.length\}\)/)
  assert.match(screen, /onPress=\{\(\) => setIsRequestsOpen\(true\)\}/)
  // Shown only when somebody is actually waiting.
  assert.match(screen, /\{pendingDirectMessages\.length > 0 && \(\s*\n\s*<Pressable/)
  assert.match(screen, /visible=\{isRequestsOpen\}/)
})

// Declining answers one request, so somebody determined just asks again.
test('a request can be blocked from the request itself', () => {
  const block = screen.slice(
    screen.indexOf('function blockDirectMessageRequest ('),
    screen.indexOf('function respondToDirectMessage (')
  )

  assert.match(block, /RPC_PEERCHAT_BLOCK/)
  assert.match(block, /peerId: invite\.fromId/)
  // It says what it will do, and it is reversible.
  assert.match(block, /cannot send another/)
  assert.match(block, /unblock them in settings/)
  // The backend hands back both lists; neither is guessed at here.
  assert.match(block, /setPendingDirectMessages\(response\.pendingDirectMessages \|\| \[\]\)/)
  assert.match(block, /setBlockedPeers\(response\.blockedPeers\)/)
})

test('every request is reachable, not just the newest', () => {
  const sheet = screen.slice(screen.indexOf('visible={isRequestsOpen}'))
  assert.match(sheet, /pendingDirectMessages\.map\(\(invite\) =>/)
  assert.match(sheet, /Nobody is waiting/)
})

// On Android the three answers sat on one row with the name, 27 points tall,
// and a long name pushed them past the right edge where Android clips instead
// of overflowing. There was nothing left to press.
test('the answers are thumb sized and cannot be pushed off the edge', () => {
  const styles = screen.slice(screen.indexOf('  requestAction: {'), screen.indexOf('  requestsList: {'))

  assert.match(styles, /minHeight: 44/)
  assert.match(styles, /flex: 1/)
  assert.match(screen, /directRequestActions: \{ flexDirection: 'row'/)
  // The name is its own row above them, and it is one line whatever its length.
  assert.match(screen, /directRequestWho: \{ alignItems: 'center', flexDirection: 'row'/)

  const sheet = screen.slice(screen.indexOf('visible={isRequestsOpen}'), screen.indexOf('isAttachSheetOpen}'))
  assert.match(sheet, /numberOfLines=\{1\} style=\{\[styles\.memberName/)
  assert.match(sheet, /keyboardShouldPersistTaps='handled'/)
})

// Accepting opens the new conversation, and the sheet used to stay up over it.
test('opening a room puts the sheet away', () => {
  const open = screen.slice(screen.indexOf('function openRoom ('), screen.indexOf('function joinRoomByKey'))
  assert.match(open, /setIsRequestsOpen\(false\)/)

  const respond = screen.slice(
    screen.indexOf('function respondToDirectMessage ('),
    screen.indexOf('function createRoom (')
  )
  assert.match(respond, /if \(accept && response\.room\) openRoom\(response\.room\)/)
})
