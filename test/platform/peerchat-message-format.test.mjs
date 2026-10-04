import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

import { formatPeerChatMessage } from '../../app/peerchat/message-format.mjs'

// Each span as its styles and its text: B bold, I italic, S struck, C code,
// L link, M mention.
const brief = (message, usernames = []) => formatPeerChatMessage(message, usernames).map((block) => (
  block.type === 'code'
    ? ['code', block.text]
    : [`${block.type}${block.level || ''}`, block.spans.map((span) => (
        `${span.bold ? 'B' : ''}${span.italic ? 'I' : ''}${span.strike ? 'S' : ''}${span.code ? 'C' : ''}${span.link ? 'L' : ''}${span.mention ? 'M' : ''}:${span.text}`
      ))]
))

describe('formatting in PeerChat messages', () => {
  test('bold, italic with either mark, and struck out', () => {
    assert.deepEqual(brief('a **b** *c* _d_ ~e~'), [
      ['paragraph', [':a ', 'B:b', ': ', 'I:c', ': ', 'I:d', ': ', 'S:e']]
    ])
  })

  test('headings from # to ###, each a line of its own', () => {
    assert.deepEqual(brief('# One\ntext\n## Two\n### Three\n#### not a heading'), [
      ['heading1', [':One']],
      ['paragraph', [':text']],
      ['heading2', [':Two']],
      ['heading3', [':Three']],
      ['paragraph', [':#### not a heading']]
    ])
    // A hash in the middle of a line, or with no space after it, is just text.
    assert.deepEqual(brief('#hashtag and C#'), [['paragraph', [':#hashtag and C#']]])
  })

  test('a fenced block is code, language name and all line breaks kept', () => {
    assert.deepEqual(brief('look:\n```js\nconst a = 1\n  return a\n```\nthen'), [
      ['paragraph', [':look:']],
      ['code', 'const a = 1\n  return a'],
      ['paragraph', [':then']]
    ])
    // Unclosed, it stays as typed.
    assert.deepEqual(brief('a ``` b'), [['paragraph', [':a ``` b']]])
  })

  test('nothing inside code is read as formatting', () => {
    assert.deepEqual(brief('`**x**` and **y `z` w**'), [
      ['paragraph', ['C:**x**', ': and ', 'B:y ', 'BC:z', 'B: w']]
    ])
    assert.deepEqual(brief('```\n# not a heading **or bold**\n```'), [
      ['code', '# not a heading **or bold**']
    ])
  })

  // Stray marks are everywhere in plain writing: sums, file names, footnotes.
  test('marks that do not pair, or sit inside a word, stay as they are', () => {
    assert.deepEqual(brief('snake_case_name, 5 * 3 * 2, and a*b'), [
      ['paragraph', [':snake_case_name, 5 * 3 * 2, and a*b']]
    ])
  })

  test('links and mentions come through whole, formatted around them', () => {
    assert.deepEqual(brief('**see https://example.com/a_b** @Andy', ['Andy']), [
      ['paragraph', ['B:see ', 'BL:https://example.com/a_b', ': ', 'M:@Andy']]
    ])
    const [block] = formatPeerChatMessage('go to hyper://abc/x_y_z', [])
    assert.equal(block.spans.at(-1).link, 'hyper://abc/x_y_z')
  })
})

describe('formatted messages on screen', () => {
  test('code can be copied, and holding it still opens the message actions', async () => {
    const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
    assert.match(screen, /accessibilityLabel='Copy code'[\s\S]{0,200}onPress=\{\(\) => handlers\.onCopyCode\(block\.text\)\}/)
    assert.match(screen, /onPress=\{\(\) => handlers\.onCopyCode\(span\.text\)\}/)
    assert.match(screen, /function copyMessageCode \(code: string\) \{\s+Clipboard\.setString\(code\)/)
    assert.equal((screen.match(/onLongPress=\{handlers\.onHold\}/g) || []).length, 2)
  })
})
