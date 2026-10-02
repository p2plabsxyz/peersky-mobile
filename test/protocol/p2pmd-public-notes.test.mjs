import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createPublicNoteSeed,
  findPublicNoteSeed,
  isPublicNoteKey,
  rememberPublicNoteSeed
} from '../../backend/p2pmd/public-notes.mjs'
import { collectP2pmdNotes } from '../../backend/p2pmd/notes-transfer.mjs'
import { saveP2pmdRoomSnapshot } from '../../backend/p2pmd/snapshots.mjs'

// A public note's key is its host's public key. Holesail hosting from that key
// makes another note; only the seed it came from brings the same one back, so
// this phone keeps the seeds of the public notes it made.
const publicKey = (letter) => `hs://0000${letter.repeat(52)}`
const privateKey = (letter) => `hs://s000${letter.repeat(52)}`

async function storage (t) {
  const documentsPath = await mkdtemp(join(tmpdir(), 'peersky-public-notes-'))
  t.after(() => rm(documentsPath, { recursive: true, force: true }))
  const hyperStoragePath = join(documentsPath, 'hyper-sdk')
  mkdirSync(hyperStoragePath, { recursive: true })
  return { documentsPath, hyperStoragePath }
}

describe('public notes this phone made', () => {
  it('knows a public key from a private one', () => {
    assert.equal(isPublicNoteKey(publicKey('a')), true)
    assert.equal(isPublicNoteKey(` ${publicKey('a')} `), true)
    assert.equal(isPublicNoteKey(privateKey('a')), false)
    assert.equal(isPublicNoteKey('hs://0000short'), false)
    assert.equal(isPublicNoteKey('https://example.com'), false)
    assert.equal(isPublicNoteKey(null), false)
  })

  it('keeps a seed and finds it again by the note key', async (t) => {
    const { hyperStoragePath } = await storage(t)
    const seed = createPublicNoteSeed()
    assert.match(seed, /^[0-9a-f]{64}$/)
    assert.notEqual(createPublicNoteSeed(), seed)

    assert.equal(rememberPublicNoteSeed(publicKey('a'), seed, hyperStoragePath), true)
    assert.equal(findPublicNoteSeed(publicKey('a'), hyperStoragePath), seed)
    assert.equal(findPublicNoteSeed(publicKey('b'), hyperStoragePath), null)
  })

  it('never keeps anything for a private note or a malformed seed', async (t) => {
    const { hyperStoragePath } = await storage(t)
    assert.equal(rememberPublicNoteSeed(privateKey('a'), createPublicNoteSeed(), hyperStoragePath), false)
    assert.equal(rememberPublicNoteSeed(publicKey('a'), 'not a seed', hyperStoragePath), false)
    assert.equal(rememberPublicNoteSeed(publicKey('a'), createPublicNoteSeed(), ''), false)
    assert.equal(findPublicNoteSeed(privateKey('a'), hyperStoragePath), null)
  })

  it('keeps the twenty used last, so a note on the recent list stays openable', async (t) => {
    const { hyperStoragePath } = await storage(t)
    const letters = 'abcdefghijklmnopqrstuv'.split('')
    const seeds = {}
    for (const letter of letters) {
      seeds[letter] = createPublicNoteSeed()
      assert.equal(rememberPublicNoteSeed(publicKey(letter), seeds[letter], hyperStoragePath), true)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    // Opening the oldest again counts as using it.
    assert.equal(rememberPublicNoteSeed(publicKey('a'), seeds.a, hyperStoragePath), true)

    assert.equal(findPublicNoteSeed(publicKey('a'), hyperStoragePath), seeds.a)
    assert.equal(findPublicNoteSeed(publicKey('b'), hyperStoragePath), null)
    assert.equal(findPublicNoteSeed(publicKey('c'), hyperStoragePath), null)
    assert.equal(findPublicNoteSeed(publicKey('v'), hyperStoragePath), seeds.v)
    const stored = JSON.parse(readFileSync(join(hyperStoragePath, 'p2pmd-public-notes.json'), 'utf8'))
    assert.equal(Object.keys(stored.notes).length, 20)
  })

  it('reads a damaged file as empty instead of failing', async (t) => {
    const { hyperStoragePath } = await storage(t)
    writeFileSync(join(hyperStoragePath, 'p2pmd-public-notes.json'), '{"version":1,"notes":')
    assert.equal(findPublicNoteSeed(publicKey('a'), hyperStoragePath), null)
    writeFileSync(join(hyperStoragePath, 'p2pmd-public-notes.json'), JSON.stringify({
      version: 1,
      notes: { [publicKey('a')]: { seed: 'zz', usedAt: 1 }, 'hs://s000x': { seed: 'a'.repeat(64), usedAt: 1 } }
    }))
    assert.equal(findPublicNoteSeed(publicKey('a'), hyperStoragePath), null)
    assert.equal(rememberPublicNoteSeed(publicKey('b'), createPublicNoteSeed(), hyperStoragePath), true)
  })

  // The seed is what hosts the note. Another device given it could take the
  // note over, so Link Device sends a public note as one to join, without it.
  it('a public note goes to a desktop as one to join, with no seed and no text', async (t) => {
    const device = await storage(t)
    const seed = createPublicNoteSeed()
    rememberPublicNoteSeed(publicKey('a'), seed, device.hyperStoragePath)
    saveP2pmdRoomSnapshot(publicKey('a'), { content: '# Open plans', lineAttributions: {}, updatedAt: 5 }, device.hyperStoragePath)
    writeFileSync(join(device.documentsPath, 'p2pmd-room-history.json'), JSON.stringify({
      items: [{ key: publicKey('a'), role: 'host', label: 'Note - Open plans', lastOpenedAt: 9 }]
    }))

    const { transfer, shared } = collectP2pmdNotes(device)
    assert.deepEqual(transfer.notes, [
      { key: publicKey('a'), role: 'client', label: 'Note - Open plans', updatedAt: 9, openedAt: 9 }
    ])
    assert.deepEqual(shared, [])
    assert.ok(!JSON.stringify(transfer).includes(seed))
  })
})

describe('hosting a public note', async () => {
  const room = await readFile(new URL('../../backend/p2pmd/room.mjs', import.meta.url), 'utf8')

  it('hosts a public note from its kept seed, and says so when the seed is gone', () => {
    assert.match(room, /if \(connector && isPublicNoteKey\(connector\)\) \{\s+publicSeed = findPublicNoteSeed\(connector\)/)
    assert.match(room, /This phone can no longer host this public note/)
  })

  it('makes a new public note from a fresh seed and keeps it before handing out the key', () => {
    assert.match(room, /\} else if \(!connector && !secure\) \{\s+publicSeed = createPublicNoteSeed\(\)/)
    assert.match(room, /connector: hostKey,\s+secure: isPrivate,/)
    assert.match(room, /if \(publicSeed && !rememberPublicNoteSeed\(room\.key, publicSeed\) && !connector\)/)
  })
})
