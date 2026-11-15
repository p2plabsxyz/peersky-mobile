// Coming back to many PeerChat messages at once played the message sound once
// per message, many times in a row. A burst now sounds once.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createSoundGate, CHAT_SOUND_GAP_MS } from '../../app/peerchat/sound-gate.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('PeerChat sounds for a burst of messages', () => {
  it('sounds once for fifty messages that arrive together, and again after', () => {
    let now = 1000
    const gate = createSoundGate(CHAT_SOUND_GAP_MS, () => now)
    let played = 0
    for (let i = 0; i < 50; i++) {
      if (gate.allow()) played++
      now += 10
    }
    assert.equal(played, 1)
    now += CHAT_SOUND_GAP_MS
    assert.equal(gate.allow(), true)
  })

  it('still sounds for each message of a live chat', () => {
    let now = 0
    const gate = createSoundGate(CHAT_SOUND_GAP_MS, () => now)
    const played = [0, 2000, 4000, 9000].filter((at) => {
      now = at
      return gate.allow()
    })
    assert.equal(played.length, 4)
  })

  it('holds every incoming sound and each batch of notifications to it, never a send', () => {
    const sounds = read('../../app/peerchat/sounds.ts')
    assert.match(sounds, /if \(kind !== 'send' && !incomingChatSound\.allow\(\)\) return/)
    const notifier = read('../../app/peerchat/notifier.ts')
    assert.match(notifier, /let sound = state\.preferences\.sounds && incomingChatSound\.allow\(\)/)
    assert.match(notifier, /sounds: sound\n\s*\}\)\n\s*sound = false/)
  })
})
