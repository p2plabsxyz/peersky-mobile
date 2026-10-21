import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  describeForwarding,
  forwardableFile,
  forwardableText,
  forwardGapMs,
  forwardItems,
  isForwardable
} from '../../app/peerchat/forwarding.mjs'
import { createPeerChatModerator } from '../../backend/peerchat/moderation.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const FILE_URL = `hyper://${'a'.repeat(52)}/1700000000000-0123456789abcdef.bin`

test('a message forwards as its words or its file, never a notice', () => {
  assert.equal(forwardableText({ id: 'a', message: 'hello there' }), 'hello there')
  assert.equal(forwardableText({ id: 'b', message: FILE_URL, fileName: 'photo.png', fileEnc: true }), null)
  assert.equal(forwardableText({ id: 'd', message: 'Cal joined', system: true }), null)
  assert.equal(forwardableText({ id: 'e', message: '  ' }), null)
  assert.equal(forwardableText(null), null)

  assert.deepEqual(forwardableFile({ id: 'b', message: FILE_URL, fileName: 'photo.png', fileSize: 12, fileEnc: true }), {
    url: FILE_URL,
    fileName: 'photo.png',
    fileSize: 12,
    fileKey: '',
    roomKey: ''
  })
  // With the key it was sealed with: its own, and the room it came from.
  assert.deepEqual(forwardableFile({
    id: 'k',
    message: FILE_URL,
    fileName: 'clip.mp4',
    fileSize: 30,
    fileEnc: true,
    fileKey: 'f'.repeat(64),
    roomKey: 'ab'.repeat(32)
  }), { url: FILE_URL, fileName: 'clip.mp4', fileSize: 30, fileKey: 'f'.repeat(64), roomKey: 'ab'.repeat(32) })
  // An old unsealed file and a notice stay where they are.
  assert.equal(forwardableFile({ id: 'c', message: 'hyper://abc/old.pdf', fileName: 'old.pdf' }), null)
  assert.equal(forwardableFile({ id: 's', message: FILE_URL, fileName: 'x.png', fileEnc: true, system: true }), null)

  assert.equal(isForwardable({ message: 'hi' }), true)
  assert.equal(isForwardable({ message: FILE_URL, fileName: 'photo.png', fileEnc: true }), true)
  assert.equal(isForwardable({ message: 'Cal joined', system: true }), false)
})

test('the picked messages go in the order they were written, words and files alike', () => {
  const messages = [
    { id: 'late', message: 'second', timestamp: 20 },
    { id: 'file', message: FILE_URL, fileName: 'a.png', fileSize: 5, fileEnc: true, timestamp: 15 },
    { id: 'early', message: 'first', timestamp: 10 },
    { id: 'notice', message: 'Cal joined', system: true, timestamp: 12 },
    { id: 'unpicked', message: 'not this', timestamp: 1 }
  ]
  assert.deepEqual(forwardItems(messages, new Set(['late', 'early', 'file', 'notice', 'gone'])), [
    { text: 'first' },
    { file: { url: FILE_URL, fileName: 'a.png', fileSize: 5, fileKey: '', roomKey: '' } },
    { text: 'second' }
  ])
  assert.deepEqual(forwardItems(undefined, new Set(['a'])), [])
})

test('forwarded messages go a moment apart, two short of the chat\'s spam limit', () => {
  assert.equal(forwardGapMs(10), 1250)
  assert.equal(forwardGapMs(5), 3334)
  assert.equal(forwardGapMs(15), 770)
  assert.equal(forwardGapMs(undefined), 1250)
  assert.equal(forwardGapMs(0), 1250)
  assert.equal(forwardGapMs(2), 10_000)
  assert.equal(describeForwarding(30), 'Forwarding 30 messages, a moment apart so the chat\'s spam limit is not reached.')
  assert.equal(describeForwarding(2), '')
})

// Thirty forwarded at once got the sender removed for spam. Each device in the
// chat counts what arrives from one person over ten seconds, and this is that
// count, run over thirty messages a gap apart.
test('forwarding thirty messages never reaches the spam limit of any chat', () => {
  for (const limit of [5, 10, 15, 50]) {
    const moderator = createPeerChatModerator()
    const gap = forwardGapMs(limit)
    const start = 1_000_000
    for (let n = 0; n < 30; n += 1) {
      const verdict = moderator.checkMessage('cafef00d', 'ab'.repeat(32), `Forwarded ${n}`, {
        now: start + n * gap,
        settings: { abuseFilter: true, nsfwFilter: true, spamRateLimit: limit }
      })
      assert.equal(verdict.allowed, true, `message ${n + 1} at a limit of ${limit}`)
    }
    // With one typed among them as well, still under it.
    const typed = moderator.checkMessage('cafef00d', 'ab'.repeat(32), 'Typed', {
      now: start + 29 * gap + 1,
      settings: { abuseFilter: true, nsfwFilter: true, spamRateLimit: limit }
    })
    assert.equal(typed.allowed, true, `a typed message at a limit of ${limit}`)
    assert.equal(moderator.isKicked('cafef00d', 'ab'.repeat(32), start + 30 * gap), false)
  }
})

test('Select picks messages, Forward sends them on a moment apart, files sealed again, and they show as forwarded', async () => {
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  assert.match(screen, /onPress=\{\(\) => startSelectingMessages\(messageActionTarget\)\} style=\{styles\.actionSheetAction\}>\s+<Text style=\{\[styles\.actionSheetActionText, \{ color: colors\.text \}\]\}>\{t\('Select'\)\}<\/Text>/)
  // While picking, a tap picks, nothing inside the message opens, and the
  // message box gives way to the count and Forward.
  assert.match(screen, /onPress=\{selectedMessageIds \? \(\) => toggleSelectedMessage\(item\) : undefined\}/)
  assert.match(screen, /pointerEvents=\{selectedMessageIds \? 'box-only' : 'auto'\}/)
  assert.match(screen, /\{tp\(\{ one: '\{count\} selected', other: '\{count\} selected' \}, selectedMessageIds\.size\)\}/)
  assert.match(screen, /showChatNote\(t\('Notices from the app cannot be forwarded\.'\)\)/)

  const forward = screen.slice(screen.indexOf('function forwardSelectedMessages'), screen.indexOf('function showChatNote'))
  assert.match(forward, /const gap = forwardGapMs\(target\.moderation\?\.spamRateLimit\)/)
  assert.match(forward, /if \(index > 0\) await new Promise\(\(resolve\) => setTimeout\(resolve, gap\)\)/)
  assert.match(forward, /if \(note\) showChatNote\(note, true\)/)
  assert.match(forward, /callRpc\(RPC_PEERCHAT_SEND, \{\s+roomKey: target\.roomKey,\s+message: item\.text,\s+forwarded: true\s+\}\)/)
  // A file is opened and sealed again for the chat it goes to, and a picture
  // or video going to a group is screened first.
  assert.match(forward, /if \(!target\.isDM && getPeerChatAttachmentMediaKind\(file\.fileName, file\.url\)\) \{/)
  assert.match(forward, /await screenUploadBytes\(\{/)
  assert.match(forward, /callRpc\(RPC_PEERCHAT_ATTACHMENT_FORWARD, \{\s+roomKey: target\.roomKey,\s+fromRoomKey: sourceRoomKey,/)
  assert.match(forward, /fileEnc: true,\s+\.\.\.\(upload\.item\.fileKey && \{ fileKey: upload\.item\.fileKey \}\),\s+forwarded: true/)
  assert.ok(forward.indexOf('screenUploadBytes') < forward.indexOf('RPC_PEERCHAT_ATTACHMENT_FORWARD'), 'screened before it is sealed')

  assert.match(screen, /\{item\.forwarded && \(\s+<Text style=\{\[styles\.forwardedLabel, media \? styles\.messageBubbleMediaInset : null, \{ color: colors\.muted \}\]\}>\{t\('Forwarded'\)\}<\/Text>/)
  assert.match(screen, /forwardedLabel: \{ fontSize: 12, fontStyle: 'italic'/)
  // Back ends picking before it leaves the chat.
  assert.match(screen, /if \(selectedMessageIds\) \{\s+setSelectedMessageIds\(null\)\s+return true\s+\}/)
})

// Picking a message from a chat's search results used to bring the whole chat
// back with the message somewhere out of sight.
test('a message picked from search results stays in view, with the search open', async () => {
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  const select = screen.slice(screen.indexOf('function startSelectingMessages'), screen.indexOf('function toggleSelectedMessage'))
  assert.doesNotMatch(select, /setIsSearching\(false\)/)
  assert.match(select, /if \(isSearching\) scrollToMessage\(message\.id\)/)
  // Closing the search afterwards keeps the picked message in view too.
  const close = screen.slice(screen.indexOf('function closeMessageSearch'), screen.indexOf('function jumpToMessage'))
  assert.match(close, /scrollToMessage\(last\.id\)/)
  // Found by id in the list as it is when the scroll happens.
  const scroll = screen.slice(screen.indexOf('function scrollToMessage ('), screen.indexOf('function canSaveMessageMedia ('))
  assert.match(scroll, /displayedMessagesRef\.current\.findIndex\(\(message\) => message\.id === messageId\)/)
})

test('holding a message makes it pop, unless Reduce Motion is on', async () => {
  const pop = await read('app/peerchat/PressPop.tsx')
  assert.match(pop, /if \(!reduceMotion\) \{/)
  assert.match(pop, /toValue: 1\.05/)
  // The bubble itself scales, so its layout stays what it was.
  assert.match(pop, /style=\{\[style, \{ transform: \[\{ scale \}\] \}\]\}/)
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  assert.match(screen, /<PressPop\n\s+accessibilityHint=\{selectedMessageIds/)
  assert.match(screen, /<\/PressPop>\n\s+\{item\.reactions && item\.reactions\.length > 0 && \(/)
})
