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
