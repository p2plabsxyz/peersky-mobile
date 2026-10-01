import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  createFunPeerName,
  FUN_PEER_NAME_ADJECTIVES,
  FUN_PEER_NAME_ANIMALS
} from '../../backend/p2pmd/peer-names.mjs'
import { getP2pmdEditorPage } from '../../backend/p2pmd/server.mjs'

function sequence (...values) {
  let index = 0
  return () => values[index++ % values.length]
}

test('a fun name is one adjective and one animal', () => {
  assert.equal(createFunPeerName(sequence(0, 0)), `${FUN_PEER_NAME_ADJECTIVES[0]} ${FUN_PEER_NAME_ANIMALS[0]}`)
  assert.equal(
    createFunPeerName(sequence(0.9999, 0.9999)),
    `${FUN_PEER_NAME_ADJECTIVES.at(-1)} ${FUN_PEER_NAME_ANIMALS.at(-1)}`
  )
  // A broken random source still gives a name rather than "undefined".
  assert.equal(createFunPeerName(() => NaN), `${FUN_PEER_NAME_ADJECTIVES[0]} ${FUN_PEER_NAME_ANIMALS[0]}`)
  assert.equal(createFunPeerName(() => 1), `${FUN_PEER_NAME_ADJECTIVES.at(-1)} ${FUN_PEER_NAME_ANIMALS.at(-1)}`)
})

// P2PMD caps names at 32 characters, and the names are meant to survive the
// stricter letters-numbers-spaces rule too, so every pair is checked.
test('every possible name fits the name rules', () => {
  assert.equal(new Set(FUN_PEER_NAME_ADJECTIVES).size, FUN_PEER_NAME_ADJECTIVES.length)
  assert.equal(new Set(FUN_PEER_NAME_ANIMALS).size, FUN_PEER_NAME_ANIMALS.length)
  for (const adjective of FUN_PEER_NAME_ADJECTIVES) {
    for (const animal of FUN_PEER_NAME_ANIMALS) {
      const name = `${adjective} ${animal}`
      assert.ok(name.length <= 32, name)
      assert.match(name, /^[A-Za-z]+ [A-Za-z]+$/)
    }
  }
})

test('the note page never calls anyone "Mobile peer"', () => {
  const html = getP2pmdEditorPage()

  assert.doesNotMatch(html, /Mobile peer'/)
  assert.match(html, /name: loadPeerDisplayName\(\) \|\| createFallbackDisplayName\(\)/)
  // The fallback is kept, so a reload does not turn the same person into a
  // stranger in the peers list.
  assert.match(html, /function createFallbackDisplayName\(\) \{[\s\S]*?persistPeerDisplayName\(name\)/)
  assert.match(html, /const FUN_NAME_WORDS = \[\["Brave"/)
})

// The desktop app asks for a name before anything else; the phone now does
// too, and offers a fun one so it is a single tap.
test('P2PMD asks for a name first and starts from a fun one', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const start = app.indexOf("activeTab === 'p2pmd' && (")
  const tab = app.slice(start, app.indexOf('onBarcodeScanned', start))

  assert.match(app, /useState\(\(\) => loadP2pmdPeerDisplayName\(\) \|\| createFunPeerName\(\)\)/)
  assert.match(tab, /\{!p2pmdPeerDisplayName \|\| isEditingP2pmdName\s*\n\s*\? \(/)
  assert.match(tab, /Choose a name to get started/)
  assert.match(tab, /setP2pmdNameDraft\(createFunPeerName\(\)\)/)
  // Create and join only show once a name is saved.
  assert.ok(tab.indexOf('Choose a name to get started') < tab.indexOf('onP2pmdRoomCreate()'))

  // A recent note or a link skips the card, and still gets a real name.
  for (const handler of ['async function onP2pmdRoomCreate', 'async function onP2pmdRoomJoin']) {
    const body = app.slice(app.indexOf(handler), app.indexOf('try {', app.indexOf(handler)))
    assert.match(body, /ensureP2pmdPeerName\(\)/, handler)
  }
})
