import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parsePeerChatIntroState,
  PEERCHAT_INTRO_MAX_BYTES,
  PEERCHAT_INTRO_POINTS,
  PEERCHAT_RULES,
  PEERCHAT_TERMS_URL,
  serializePeerChatIntroState
} from '../../app/peerchat/intro-state.mjs'

test('PeerChat intro uses the mentor-approved four-point explanation', () => {
  assert.equal(PEERCHAT_INTRO_POINTS.length, 4)
  assert.match(PEERCHAT_INTRO_POINTS[0], /No server in the middle/)
  assert.match(PEERCHAT_INTRO_POINTS[1], /both phones are connected/)
  assert.match(PEERCHAT_INTRO_POINTS[2], /running in the background/)
  assert.match(PEERCHAT_INTRO_POINTS[3], /no internet at all/)
})

test('PeerChat intro completion accepts only its current versioned marker', () => {
  assert.equal(parsePeerChatIntroState(serializePeerChatIntroState()), true)
  // Agreeing before the rules existed does not count as agreeing to them.
  assert.equal(parsePeerChatIntroState('{"version":1,"completed":true}'), false)
  assert.equal(parsePeerChatIntroState('{"version":3,"completed":true}'), false)
  assert.equal(parsePeerChatIntroState('{"version":2,"completed":false}'), false)
  assert.equal(parsePeerChatIntroState('{invalid'), false)
  assert.equal(parsePeerChatIntroState('x'.repeat(PEERCHAT_INTRO_MAX_BYTES + 1)), false)
})

// App Review asks that people agree to terms with no tolerance for
// objectionable content or abusive users before they can post anything.
test('PeerChat states its rules, and the terms they come from', async () => {
  const { readFile } = await import('node:fs/promises')
  assert.match(PEERCHAT_RULES.join(' '), /under 18, ever/)
  assert.match(PEERCHAT_RULES.join(' '), /report them\. We read every report within 24 hours/)
  assert.match(PEERCHAT_RULES.join(' '), /P2P Republic, a public room anyone can join/)
  assert.equal(PEERCHAT_TERMS_URL, 'https://github.com/p2plabsxyz/peersky-mobile/blob/main/TERMS.md')

  const terms = await readFile(new URL('../../TERMS.md', import.meta.url), 'utf8')
  assert.match(terms, /There is no tolerance for\nobjectionable content or abusive users/)
  assert.match(terms, /contact@p2plabs\.xyz and we read every one within 24 hours/)
  assert.doesNotMatch(terms, /—/)

  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const intro = screen.slice(screen.indexOf('if (showIntro) {'), screen.indexOf('if (isInitialized && !profile?.username)'))
  assert.ok(intro.indexOf('PEERCHAT_RULES.map') < intro.indexOf('>I understand<'))
  assert.match(intro, /onPress=\{\(\) => onOpenUrl\(PEERCHAT_TERMS_URL\)\}/)
  assert.doesNotMatch(intro, /Agree and continue/)
})
