import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const source = await readFile(new URL('../../app/haptics.ts', import.meta.url), 'utf8')

// A buzz that fails is not worth interrupting what the press was for, so
// nothing here is awaited and nothing throws.
test('a failed buzz never interrupts what the press was for', () => {
  assert.match(source, /void Haptics\.impactAsync\([\s\S]{0,40}\)\.catch\(\(\) => \{\}\)/)
  assert.doesNotMatch(source, /await Haptics/)
})

test('the three weights map onto the platform styles', () => {
  for (const weight of ['Light', 'Medium', 'Heavy']) {
    assert.match(source, new RegExp(`Haptics\\.ImpactFeedbackStyle\\.${weight}`))
  }
})

// Holding something is a decision the phone should answer to.
test('every long press in the app answers back', async () => {
  const files = [
    ['../../app/peerchat/PeerChatScreen.tsx', 9],
    ['../../app/hyperdrive/HyperdriveScreen.tsx', 1],
    ['../../app/index.tsx', 1]
  ]

  for (const [file, expected] of files) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8')
    const holds = (text.match(/onLongPress=/g) || []).length
    const buzzes = (text.match(/tapFeedback\(/g) || []).length
    // Holds that share a handler, which buzzes once for all of them.
    const shared = (text.match(/onLongPress=\{(?:onShowActions|handlers\.onHold)\}/g) || []).length
    assert.equal(holds, expected, `${file} gained a long press`)
    assert.ok(buzzes >= holds - shared + Math.min(shared, 1), `${file} has a long press that says nothing`)
  }
})
