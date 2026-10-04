import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { forwardableText, forwardTexts } from '../../app/peerchat/forwarding.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('a message forwards as its words, never a file, a picture or a notice', () => {
  assert.equal(forwardableText({ id: 'a', message: 'hello there' }), 'hello there')
  assert.equal(forwardableText({ id: 'b', message: 'hyper://abc/photo.png', fileName: 'photo.png', fileEnc: true }), null)
  assert.equal(forwardableText({ id: 'c', message: 'hyper://abc/old.pdf', fileName: 'old.pdf' }), null)
  assert.equal(forwardableText({ id: 'd', message: 'Bob joined', system: true }), null)
  assert.equal(forwardableText({ id: 'e', message: '  ' }), null)
  assert.equal(forwardableText(null), null)
})

test('the picked messages go in the order they were written', () => {
  const messages = [
    { id: 'late', message: 'second', timestamp: 20 },
    { id: 'file', message: 'hyper://x/a.png', fileName: 'a.png', timestamp: 5 },
    { id: 'early', message: 'first', timestamp: 10 },
    { id: 'unpicked', message: 'not this', timestamp: 1 }
  ]
  assert.deepEqual(forwardTexts(messages, new Set(['late', 'early', 'file', 'gone'])), ['first', 'second'])
  assert.deepEqual(forwardTexts(undefined, new Set(['a'])), [])
})

test('Select picks messages, Forward sends them on to a chat, and they show as forwarded', async () => {
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  assert.match(screen, /onPress=\{\(\) => startSelectingMessages\(messageActionTarget\)\} style=\{styles\.actionSheetAction\}>\s+<Text style=\{\[styles\.actionSheetActionText, \{ color: colors\.text \}\]\}>Select<\/Text>/)
  // While picking, a tap picks, nothing inside the message opens, and the
  // message box gives way to the count and Forward.
  assert.match(screen, /onPress=\{selectedMessageIds \? \(\) => toggleSelectedMessage\(item\) : undefined\}/)
  assert.match(screen, /pointerEvents=\{selectedMessageIds \? 'box-only' : 'auto'\}/)
  assert.match(screen, /\{selectedMessageIds\.size\} selected/)
  assert.match(screen, /callRpc\(RPC_PEERCHAT_SEND, \{\s+roomKey: target\.roomKey,\s+message: text,\s+forwarded: true\s+\}\)/)
  assert.match(screen, /\{item\.forwarded && \(\s+<Text style=\{\[styles\.forwardedLabel, \{ color: colors\.muted \}\]\}>Forwarded<\/Text>/)
  assert.match(screen, /forwardedLabel: \{ fontSize: 12, fontStyle: 'italic'/)
  // Back ends picking before it leaves the chat.
  assert.match(screen, /if \(selectedMessageIds\) \{\s+setSelectedMessageIds\(null\)\s+return true\s+\}/)
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
