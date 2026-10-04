import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Desktop pops when you react and when someone reacts in the chat you have
// open. The phone was silent for both.
test('a reaction pops, yours and other people\'s', async () => {
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  assert.ok((await stat(new URL('../../assets/sounds/peerchat/pop.mp3', import.meta.url))).size > 1000)

  // Adding or changing yours, not taking it back.
  const react = screen.slice(screen.indexOf('function sendReaction'), screen.indexOf('function sendMessageActionReaction'))
  assert.match(react, /if \(soundsEnabled && currentEmoji !== emoji\) \{\s+playPeerChatSound\('pop'/)

  // Someone else's: the count without your own goes up on a message already
  // on screen. A new message plays its own sound instead.
  assert.match(screen, /function countOthersReactions \(message: \{ reactions\?: PeerChatReactionSummary\[\] \}\) \{\s+return \(message\.reactions \|\| \[\]\)\.reduce\(\(total, reaction\) => total \+ reaction\.count - \(reaction\.self \? 1 : 0\), 0\)/)
  assert.match(screen, /\(previousReactions\.get\(message\.id\) \?\? Infinity\) < countOthersReactions\(message\)/)
  assert.match(screen, /\} else if \(hasNewReaction\) \{\s+playPeerChatSound\('pop'/)

  // Android plays PeerChat's sounds from its own pool, which needs the file.
  const plugin = await read('plugins/with-peerchat-background.js')
  assert.match(plugin, /\['pop\.mp3', 'peerchat_pop\.mp3'\]/)
  const module = await read('plugins/templates/PeerChatBackgroundModule.kt.template')
  assert.match(module, /soundIds\["pop"\] = pool\.load\(reactApplicationContext, R\.raw\.peerchat_pop, 1\)/)
})

// A picture fills its bubble and claims the touch, so only the bubble's thin
// edge answered a long press.
test('holding a picture, video or file opens the message actions', async () => {
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  const attachment = screen.slice(screen.indexOf('function PeerChatAttachment ('), screen.indexOf('function PeerChatVideo ('))
  assert.equal((attachment.match(/onLongPress=\{onShowActions\}/g) || []).length, 4)
  assert.match(screen, /onShowActions=\{\(\) => \{\s+tapFeedback\(\)\s+showMessageActions\(item\)\s+\}\}/)
})
