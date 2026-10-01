// P2PMD notes moving between a person's phone and desktop. What has to hold:
// a note arrives with its name and, when it was hosted, its text; nothing
// tied to the device it came from travels (a cached drive address sent every
// write on a copied desktop profile to a drive it could not write to,
// p2pmd#18); and nothing already on the phone is replaced.
//
// The transfer in "reads the transfer P2PMD on the desktop reads" is the same
// one test/notes-transfer.test.js in P2PMD checks.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_TRANSFER_NOTES,
  MAX_TRANSFER_TEXT_BYTES,
  P2PMD_INCOMING_FILE,
  canonicalNoteKey,
  collectP2pmdNotes,
  isPrivateNoteKey,
  normalizeP2pmdNotesTransfer,
  takeP2pmdNotes
} from '../../backend/p2pmd/notes-transfer.mjs'
import { loadP2pmdRoomSnapshot, saveP2pmdRoomSnapshot } from '../../backend/p2pmd/snapshots.mjs'

// Private notes, the only kind another device can host: the key is what the
// host's keys are made from. This phone makes them that way.
const key = (letter) => `hs://s000${letter.repeat(52)}`
// What a desktop makes unless asked: the host's public key, hostable only there.
const publicKey = (letter) => `hs://0000${letter.repeat(52)}`
const base = (noteKey) => noteKey.slice('hs://'.length)

async function phone (t) {
  const documentsPath = await mkdtemp(join(tmpdir(), 'peersky-p2pmd-notes-'))
  t.after(() => rm(documentsPath, { recursive: true, force: true }))
  const hyperStoragePath = join(documentsPath, 'hyper-sdk')
  mkdirSync(hyperStoragePath, { recursive: true })
  return { documentsPath, hyperStoragePath }
}

function writeHistory ({ documentsPath }, items) {
  writeFileSync(join(documentsPath, 'p2pmd-room-history.json'), JSON.stringify({ items }))
}

function hostedCopy ({ hyperStoragePath }, noteKey, content, updatedAt = 5) {
  assert.equal(saveP2pmdRoomSnapshot(noteKey, { content, lineAttributions: {}, updatedAt }, hyperStoragePath), true)
}

function leaveIncoming ({ documentsPath }, transfer) {
  writeFileSync(join(documentsPath, P2PMD_INCOMING_FILE), JSON.stringify(transfer))
}

describe('notes going to a desktop', () => {
  it('sends a hosted note with its text, and a joined one without', async (t) => {
    const device = await phone(t)
    writeFileSync(join(device.documentsPath, 'p2pmd-profile.json'), JSON.stringify({ name: '  Bea  ' }))
    writeHistory(device, [
      { key: key('a'), role: 'host', label: 'Note - Trip', lastOpenedAt: 20 },
      { key: key('b'), role: 'client', label: 'Note - Theirs', lastOpenedAt: 10 }
    ])
    hostedCopy(device, key('a'), '# Trip', 15)

    const { transfer, shared } = collectP2pmdNotes(device)

    assert.deepEqual(transfer, {
      version: 1,
      name: 'Bea',
      notes: [
        { key: key('a'), role: 'host', label: 'Note - Trip', content: '# Trip', updatedAt: 15, openedAt: 20 },
        { key: key('b'), role: 'client', label: 'Note - Theirs', updatedAt: 10, openedAt: 10 }
      ]
    })
    // Only the note that went with its text is shared: without it, the
    // desktop has nothing it could host.
    assert.deepEqual(shared, [key('a')])
  })

  it('sends a hosted note without a copy here as one to join', async (t) => {
    const device = await phone(t)
    writeHistory(device, [{ key: key('a'), role: 'host', label: '', lastOpenedAt: 1 }])

    const { transfer, shared } = collectP2pmdNotes(device)

    assert.equal(transfer.notes[0].content, undefined)
    assert.deepEqual(shared, [])
  })

  it('leaves out text that would not fit, and sends nothing at all when there is nothing', async (t) => {
    const device = await phone(t)
    assert.equal(collectP2pmdNotes(device), null)

    writeHistory(device, [
      { key: key('a'), role: 'host', lastOpenedAt: 2 },
      { key: key('b'), role: 'host', lastOpenedAt: 1 }
    ])
    hostedCopy(device, key('a'), 'x'.repeat(MAX_TRANSFER_TEXT_BYTES - 10))
    hostedCopy(device, key('b'), 'y'.repeat(20))

    const { transfer, shared } = collectP2pmdNotes(device)

    assert.equal(transfer.notes[0].content.length, MAX_TRANSFER_TEXT_BYTES - 10)
    assert.equal(transfer.notes[1].content, undefined)
    assert.deepEqual(shared, [key('a')])
  })

  it('never sends anything tied to this phone', async (t) => {
    const device = await phone(t)
    writeHistory(device, [{
      key: key('a'),
      role: 'host',
      lastOpenedAt: 1,
      localUrl: 'http://127.0.0.1:8989',
      port: 8989,
      driveUrl: 'hyper://only-this-phone-can-write/'
    }])
    hostedCopy(device, key('a'), 'text')

    const sent = JSON.stringify(collectP2pmdNotes(device))

    for (const phoneOnly of ['127.0.0.1', '8989', 'hyper://', 'localUrl', 'port']) {
      assert.equal(sent.includes(phoneOnly), false, `sent ${phoneOnly}`)
    }
  })
})

describe('notes coming from a desktop', () => {
  it('keeps the text of a hosted note as this phone\'s copy, ready to host only when nobody answers', async (t) => {
    const device = await phone(t)
    leaveIncoming(device, {
      version: 1,
      name: 'Ada',
      notes: [
        { key: key('a'), role: 'host', label: 'Note - Plans', content: '# Plans', updatedAt: 5, openedAt: 7 },
        { key: key('b'), role: 'client', label: 'Note - Theirs', updatedAt: 3, openedAt: 4 }
      ]
    })

    const taken = takeP2pmdNotes(device)

    assert.deepEqual(taken, {
      ok: true,
      name: 'Ada',
      notes: [
        { key: key('a'), role: 'host', label: 'Note - Plans', lastOpenedAt: 7, shared: true },
        { key: key('b'), role: 'client', label: 'Note - Theirs', lastOpenedAt: 4, shared: false }
      ]
    })
    assert.equal(loadP2pmdRoomSnapshot(key('a'), device.hyperStoragePath).content, '# Plans')
    assert.equal(loadP2pmdRoomSnapshot(key('b'), device.hyperStoragePath), null)
    // The app removes it once its list is saved.
    assert.equal(existsSync(join(device.documentsPath, P2PMD_INCOMING_FILE)), true)
  })

  it('replaces no copy already here', async (t) => {
    const device = await phone(t)
    hostedCopy(device, key('a'), 'my newer text', 50)
    leaveIncoming(device, { version: 1, notes: [{ key: key('a'), role: 'host', content: 'their older text', openedAt: 1 }] })

    const taken = takeP2pmdNotes(device)

    assert.equal(taken.notes[0].role, 'host')
    assert.equal(loadP2pmdRoomSnapshot(key('a'), device.hyperStoragePath).content, 'my newer text')
  })

  it('makes a hosted note with no copy anywhere here one to join, never one to host empty', async (t) => {
    const device = await phone(t)
    leaveIncoming(device, { version: 1, notes: [{ key: key('a'), role: 'host', openedAt: 1 }] })

    assert.deepEqual(takeP2pmdNotes(device).notes, [{ key: key('a'), role: 'client', label: '', lastOpenedAt: 1, shared: false }])
    assert.equal(loadP2pmdRoomSnapshot(key('a'), device.hyperStoragePath), null)
  })

  it('keeps nothing it does not understand', async (t) => {
    const device = await phone(t)
    leaveIncoming(device, {
      version: 1,
      hyperdriveUrl: 'hyper://someone-elses-drive/',
      notes: [{
        key: key('a'),
        role: 'host',
        content: 'text',
        openedAt: 1,
        localUrl: 'http://127.0.0.1:8989',
        port: 8989,
        seed: '5eed'.repeat(16),
        draftDriveUrl: 'hyper://someone-elses-drafts/'
      }]
    })

    const taken = JSON.stringify(takeP2pmdNotes(device))
    const snapshots = readdirSync(join(device.hyperStoragePath, 'p2pmd-rooms'))
      .map((name) => readFileSync(join(device.hyperStoragePath, 'p2pmd-rooms', name), 'utf8'))
      .join('')

    for (const foreign of ['hyper://', '127.0.0.1', '8989', '5eed']) {
      assert.equal(taken.includes(foreign), false, `took ${foreign}`)
      assert.equal(snapshots.includes(foreign), false, `kept ${foreign}`)
    }
  })

  it('refuses anything that is not a transfer', async (t) => {
    const device = await phone(t)
    assert.deepEqual(takeP2pmdNotes(device), { ok: false, notes: [], name: '' })
    for (const bad of ['text', { version: 2, notes: [] }, { version: 1 }, { version: 1, notes: {} }]) {
      leaveIncoming(device, bad)
      assert.deepEqual(takeP2pmdNotes(device), { ok: false, notes: [], name: '' })
    }
  })
})

describe('a note that is not private', () => {
  it('goes to a desktop as one to join', async (t) => {
    const device = await phone(t)
    writeHistory(device, [{ key: publicKey('a'), role: 'host', label: 'Note - Joined copy', lastOpenedAt: 2 }])
    hostedCopy(device, publicKey('a'), 'text')

    const { transfer, shared } = collectP2pmdNotes(device)

    assert.deepEqual(transfer.notes, [{ key: publicKey('a'), role: 'client', label: 'Note - Joined copy', updatedAt: 2, openedAt: 2 }])
    assert.deepEqual(shared, [])
  })

  it('arrives from a desktop as one to join, with no copy kept', async (t) => {
    const device = await phone(t)
    leaveIncoming(device, { version: 1, notes: [{ key: publicKey('a'), role: 'host', label: 'Note - Desk plan', content: '# Desk plan', openedAt: 5 }] })

    assert.deepEqual(takeP2pmdNotes(device).notes, [{ key: publicKey('a'), role: 'client', label: 'Note - Desk plan', lastOpenedAt: 5, shared: false }])
    assert.equal(loadP2pmdRoomSnapshot(publicKey('a'), device.hyperStoragePath), null)
  })

  it('is told apart by its key', () => {
    assert.equal(isPrivateNoteKey(key('a')), true)
    assert.equal(isPrivateNoteKey(publicKey('a')), false)
    assert.equal(isPrivateNoteKey(''), false)
  })
})

describe('the transfer itself', () => {
  it('knows a note key in either form and nothing else', () => {
    assert.equal(canonicalNoteKey(` ${base(key('a'))} `), key('a'))
    assert.equal(canonicalNoteKey(key('a')), key('a'))
    assert.equal(canonicalNoteKey('hs://short'), '')
    assert.equal(canonicalNoteKey(`hs://${'a'.repeat(40)}/path`), '')
    assert.equal(canonicalNoteKey(`hs://${'é'.repeat(40)}`), '')
    assert.equal(canonicalNoteKey(42), '')
  })

  it('reads the transfer P2PMD on the desktop reads', () => {
    const transfer = {
      version: 1,
      name: '  Bea  ',
      extra: 'dropped',
      notes: [
        { key: base(key('q')), role: 'host', label: ' Note -\n Trip  ', content: '# Trip', updatedAt: 10, openedAt: 20, localUrl: 'x' },
        { key: key('q'), role: 'host', content: 'a second copy of the same note' },
        { key: 'hs://not-a-key', role: 'client' },
        { key: key('r'), role: 'anything', content: 'a joined note never carries text', updatedAt: -1, openedAt: 'soon' }
      ]
    }

    assert.deepEqual(normalizeP2pmdNotesTransfer(transfer), {
      version: 1,
      name: 'Bea',
      notes: [
        { key: key('q'), role: 'host', label: 'Note - Trip', content: '# Trip', updatedAt: 10, openedAt: 20 },
        { key: key('r'), role: 'client', label: '', updatedAt: 0, openedAt: 0 }
      ]
    })
  })

  it('takes at most the five a recent list shows', () => {
    const notes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((letter) => ({ key: key(letter), role: 'client' }))
    assert.equal(normalizeP2pmdNotesTransfer({ version: 1, notes }).notes.length, MAX_TRANSFER_NOTES)
  })
})
