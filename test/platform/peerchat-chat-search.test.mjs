import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

// The chat list's search found chats by name and by their last message only.
test('the chat list searches rooms and every message, chats first', () => {
  assert.match(screen, /placeholder=\{t\('Search rooms and messages'\)\}/)
  const items = screen.slice(screen.indexOf('const landingItems: PeerChatListItem[] = ['), screen.indexOf('const directory ='))
  assert.ok(items.indexOf("kind: 'room'") < items.indexOf("kind: 'message'"), 'chats whose name matches, then messages')
  assert.match(screen, /data=\{landingItems\}/)
  // From what this phone keeps, once typing pauses, and nothing goes to peers.
  const search = screen.slice(screen.indexOf('const isRoomOpen = Boolean(activeRoom)'), screen.indexOf('function openSearchResult ('))
  assert.match(search, /callRpc\(RPC_PEERCHAT_SEARCH, \{ query \}\)/)
  assert.match(search, /setTimeout\(\(\) => \{/)
  assert.match(search, /MESSAGE_SEARCH_DELAY_MS/)
})

test('a found message shows its chat, who sent it, the words around the match and the time', () => {
  const row = screen.slice(screen.indexOf('function renderSearchResult ('), screen.indexOf('  return (\n    <>\n      <FlatList'))
  assert.match(row, /\{result\.roomName\}/)
  assert.match(row, /const sender = result\.self \? t\('You'\) : result\.isDM \? '' : result\.senderName/)
  assert.match(row, /splitPeerChatSearchMatch\(result\.message, roomSearchQuery\)/)
  assert.match(row, /styles\.searchMatch/)
  assert.match(row, /formatListTime\(result\.timestamp\)/)
  assert.match(row, /onPress=\{\(\) => openSearchResult\(result\)\}/)
})

test('tapping a found message opens its chat at that message', () => {
  const open = screen.slice(screen.indexOf('function openSearchResult ('), screen.indexOf('async function saveProfile ('))
  assert.match(open, /openRoom\(room\)\s+jumpTargetRef\.current = \{ roomKey: room\.roomKey, messageId: result\.id \}/)
})

// The same jump serves a reply's quote: older messages are read in until the
// message is there, and it is scrolled to and marked for a moment.
test('a message to show is loaded, scrolled to and marked', () => {
  const effect = screen.slice(screen.indexOf('// A message to show: scrolled to and marked'), screen.indexOf('useEffect(() => {\n    if (!isReady || activeRoom) return'))
  assert.match(effect, /displayedMessages\.findIndex\(\(message\) => message\.id === target\.messageId\)/)
  assert.match(effect, /if \(hasOlderRef\.current && historyLimitRef\.current < MAX_HISTORY_MESSAGES\) \{\s+historyLimitRef\.current = Math\.min\(MAX_HISTORY_MESSAGES, historyLimitRef\.current \* 2\)/)
  assert.match(effect, /showMessageAt\(index, target\.messageId\)/)
  assert.match(screen, /const limit = historyLimitRef\.current/)
  assert.match(screen, /\.\.\.\(limit > DEFAULT_HISTORY_MESSAGES && \{ limit \}\)/)
  assert.match(screen, /hasOlderRef\.current = response\.hasOlder === true/)
  // A refresh that started before the window grew does not count as the one
  // that read it.
  assert.match(screen, /historyLoadedRef\.current = limit === historyLimitRef\.current/)
  const show = screen.slice(screen.indexOf('function showMessageAt ('), screen.indexOf('function scrollToMessage ('))
  assert.match(show, /setHighlightedMessageId\(messageId\)/)
  assert.match(show, /HIGHLIGHT_MS/)
  assert.match(screen, /const marked = selectedMessageIds\?\.has\(item\.id\) === true \|\| highlightedMessageId === item\.id/)
})

test('tapping a reply\'s quote goes to the message it quotes', () => {
  assert.match(screen, /onPress=\{\(\) => jumpToMessage\(item\.replyTo\?\.id \|\| ''\)\}/)
  assert.match(screen, /accessibilityHint=\{t\('Shows the message this replies to'\)\}/)
  const jump = screen.slice(screen.indexOf('function jumpToMessage ('), screen.indexOf('function showMessageAt ('))
  // The whole chat, not search results, is where it is looked for.
  assert.match(jump, /setIsSearching\(false\)/)
})

test('Accept shows it is working until the chat opens', () => {
  const respond = screen.slice(screen.indexOf('function respondToDirectMessage ('), screen.indexOf('function createRoom ('))
  assert.match(respond, /if \(accept\) \{\s+acceptingInviteRef\.current = invite\s+setAcceptingRoomKey\(invite\.roomKey\)/)
  assert.match(respond, /if \(accept && response\.room\) openRoom\(response\.room\)/)
  assert.match(respond, /finally \{\s+if \(accept\) acceptingInviteRef\.current = null\s+if \(accept && mountedRef\.current\) setAcceptingRoomKey\(null\)/)
  const sheet = screen.slice(screen.indexOf('visible={isRequestsOpen}'))
  assert.match(sheet, /\{acceptingRoomKey === invite\.roomKey\s+\? <ActivityIndicator color='#ffffff' \/>/)
  // The backend takes the request off the waiting list as soon as it starts,
  // so the one being accepted stays on screen, spinning, until the chat opens.
  assert.match(screen, /const shownRequests = acceptingInvite && !pendingDirectMessages\.some\(\(invite\) => invite\.roomKey === acceptingInvite\.roomKey\)\s+\? \[acceptingInvite, \.\.\.pendingDirectMessages\]/)
})

// On a Samsung phone the keyboard offered saved passwords over the message box
// once a message was sent.
test('the message box is never taken for a login', () => {
  const composer = screen.slice(screen.indexOf("placeholder={t('Message')}"), screen.indexOf("placeholder={t('Message')}") + 600)
  assert.match(composer, /autoComplete='off'/)
  assert.match(composer, /importantForAutofill='no'/)
  assert.match(composer, /textContentType='none'/)
})
