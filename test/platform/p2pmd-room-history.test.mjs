import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  filterP2pmdRoomHistory,
  formatP2pmdRoomHistoryKey,
  isPrivateP2pmdNoteKey,
  markP2pmdRoomsShared,
  MAX_P2PMD_ROOM_HISTORY_FILE_BYTES,
  MAX_P2PMD_RECENT_ROOMS,
  mergeP2pmdRoomsFromDevice,
  normalizeP2pmdRoomKey,
  parseP2pmdNoteLink,
  P2PMD_RECENT_SEARCH_AFTER,
  parseP2pmdRoomHistory,
  readP2pmdRoomHistoryFile,
  recordP2pmdRoom,
  serializeP2pmdRoomHistory,
  writeP2pmdRoomHistoryFile
} from '../../app/p2pmd-room-history.mjs'

const roomKey = (character) => `hs://${character.repeat(52)}`

describe('P2PMD room history', () => {
  test('round-trips valid room keys in newest-first order', () => {
    const rooms = [
      { key: roomKey('a'), role: 'host', label: '', lastOpenedAt: 10 },
      { key: roomKey('b'), role: 'client', label: '', lastOpenedAt: 20 }
    ]

    assert.deepEqual(
      parseP2pmdRoomHistory(serializeP2pmdRoomHistory(rooms)),
      [rooms[1], rooms[0]]
    )
  })

  test('deduplicates reopened rooms and bounds the list', () => {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let rooms = []
    for (let index = 0; index < MAX_P2PMD_RECENT_ROOMS + 2; index++) {
      rooms = recordP2pmdRoom(rooms, {
        key: roomKey(characters[index]),
        role: index === 0 ? 'host' : 'client',
        lastOpenedAt: index
      })
    }

    rooms = recordP2pmdRoom(rooms, {
      key: roomKey('d'),
      role: 'host',
      lastOpenedAt: 100
    })

    assert.equal(rooms.length, MAX_P2PMD_RECENT_ROOMS)
    assert.equal(rooms[0].key, roomKey('d'))
    assert.equal(rooms[0].role, 'host')
    assert.equal(rooms.filter((room) => room.key === roomKey('d')).length, 1)
  })

  test('rejects malformed keys, timestamps, and persisted values', () => {
    assert.deepEqual(parseP2pmdRoomHistory('{invalid'), [])
    assert.deepEqual(parseP2pmdRoomHistory({
      items: [
        { key: 'https://example.com/', lastOpenedAt: 1 },
        { key: 'hs://short', lastOpenedAt: 2 },
        { key: `${roomKey('a')}/path`, lastOpenedAt: 3 },
        { key: roomKey('b'), lastOpenedAt: -1 }
      ]
    }), [])
  })

  test('canonicalizes raw and hs keys for stable deduplication', () => {
    const raw = 'A'.repeat(52)
    assert.equal(normalizeP2pmdRoomKey(raw), `hs://${raw}`)
    assert.equal(normalizeP2pmdRoomKey(`HS://${raw}`), `hs://${raw}`)

    const rooms = parseP2pmdRoomHistory({
      items: [
        { key: raw, lastOpenedAt: 1 },
        { key: `hs://${raw}`, lastOpenedAt: 2 }
      ]
    })
    assert.equal(rooms.length, 1)
    assert.equal(rooms[0].lastOpenedAt, 2)
    assert.equal(rooms[0].role, 'client')
  })

  test('formats room keys without exposing the full key in setup UI', () => {
    assert.equal(formatP2pmdRoomHistoryKey(roomKey('a')), `${'a'.repeat(20)}...`)
    assert.equal(formatP2pmdRoomHistoryKey('invalid'), '')
  })

  test('keeps a note name once it is known, and bounds it', () => {
    let rooms = recordP2pmdRoom([], {
      key: roomKey('a'),
      role: 'host',
      label: 'Slides - Welcome to Your Presentation',
      lastOpenedAt: 10
    })
    assert.equal(rooms[0].label, 'Slides - Welcome to Your Presentation')

    // Reopening says nothing about the contents, so the name already worked
    // out survives rather than being blanked.
    rooms = recordP2pmdRoom(rooms, { key: roomKey('a'), role: 'host', lastOpenedAt: 20 })
    assert.equal(rooms[0].label, 'Slides - Welcome to Your Presentation')

    // The text comes out of a document that may not be yours. It is only ever
    // displayed, but it still gets flattened to one line and cut short.
    rooms = recordP2pmdRoom(rooms, {
      key: roomKey('b'),
      role: 'client',
      label: `  Note -   ${'x'.repeat(200)}\n\nsecond line  `,
      lastOpenedAt: 30
    })
    assert.ok(rooms[0].label.length <= 64)
    assert.doesNotMatch(rooms[0].label, /\n/)
    assert.match(rooms[0].label, /^Note - x+$/)
  })

  test('persists rooms for restart and rejects oversized files before reading', () => {
    const file = createMemoryFile()
    const rooms = [{ key: roomKey('a'), role: 'host', label: '', lastOpenedAt: 10 }]

    writeP2pmdRoomHistoryFile(file, rooms)
    assert.deepEqual(readP2pmdRoomHistoryFile(file), rooms)

    let read = false
    assert.deepEqual(readP2pmdRoomHistoryFile({
      exists: true,
      size: MAX_P2PMD_ROOM_HISTORY_FILE_BYTES + 1,
      textSync: () => {
        read = true
        return '{}'
      }
    }), [])
    assert.equal(read, false)
  })
})

// A note shared in a chat used to come back as "Unsupported URL scheme", so the
// key had to be copied out of the message by hand.
// A note this phone hosts that is on the person's desktop too. It is looked
// for there first, so the two devices never host it at once and drift apart.
describe('P2PMD notes on another device too', () => {
  test('stays shared whichever way it is opened next', () => {
    const shared = [{ key: roomKey('a'), role: 'host', label: 'Note - Plans', lastOpenedAt: 1, shared: true }]

    // Joined live on the desktop, or reopened from the copy here.
    for (const role of ['client', 'host']) {
      assert.deepEqual(recordP2pmdRoom(shared, { key: roomKey('a'), role, lastOpenedAt: 9 }), [
        { key: roomKey('a'), role: 'host', label: 'Note - Plans', lastOpenedAt: 9, shared: true }
      ])
    }
  })

  test('is only ever a note this phone hosts, and survives the file', () => {
    assert.deepEqual(parseP2pmdRoomHistory({ items: [{ key: roomKey('a'), role: 'client', lastOpenedAt: 1, shared: true }] }), [
      { key: roomKey('a'), role: 'client', label: '', lastOpenedAt: 1 }
    ])
    const rooms = [{ key: roomKey('a'), role: 'host', label: '', lastOpenedAt: 1, shared: true }]
    assert.deepEqual(parseP2pmdRoomHistory(serializeP2pmdRoomHistory(rooms)), rooms)
  })

  test('takes a desktop\'s notes without replacing anything here', () => {
    const rooms = [
      { key: roomKey('a'), role: 'client', label: 'Mine', lastOpenedAt: 50 },
      { key: roomKey('b'), role: 'host', label: 'Also mine', lastOpenedAt: 40 }
    ]

    const merged = mergeP2pmdRoomsFromDevice(rooms, [
      // Joined here before; now this phone has a copy of it too.
      { key: roomKey('a'), role: 'host', label: 'Theirs', lastOpenedAt: 10, shared: true },
      { key: roomKey('c'), role: 'host', label: 'New', lastOpenedAt: 45, shared: true },
      { key: roomKey('d'), role: 'client', label: 'Joined there', lastOpenedAt: 30, shared: false },
      { key: 'not a key', role: 'host', lastOpenedAt: 99 }
    ])

    assert.deepEqual(merged, [
      { key: roomKey('a'), role: 'host', label: 'Mine', lastOpenedAt: 50, shared: true },
      { key: roomKey('c'), role: 'host', label: 'New', lastOpenedAt: 45, shared: true },
      { key: roomKey('b'), role: 'host', label: 'Also mine', lastOpenedAt: 40 },
      { key: roomKey('d'), role: 'client', label: 'Joined there', lastOpenedAt: 30 }
    ])
  })

  // With thirty on the list, a desktop's five no longer push out this
  // phone's own five.
  test('keeps every note after taking a desktop\'s, newest first', () => {
    const rooms = ['a', 'b', 'c', 'd', 'e'].map((character, index) => ({ key: roomKey(character), role: 'host', label: '', lastOpenedAt: index }))
    const incoming = ['v', 'w', 'x', 'y', 'z'].map((character, index) => ({ key: roomKey(character), role: 'client', label: '', lastOpenedAt: 10 + index }))

    assert.deepEqual(
      mergeP2pmdRoomsFromDevice(rooms, incoming).map((room) => room.key),
      ['z', 'y', 'x', 'w', 'v', 'e', 'd', 'c', 'b', 'a'].map(roomKey)
    )
  })

  test('marks only hosted notes that went with their text', () => {
    const rooms = [
      { key: roomKey('a'), role: 'host', label: '', lastOpenedAt: 2 },
      { key: roomKey('b'), role: 'client', label: '', lastOpenedAt: 1 }
    ]

    assert.deepEqual(markP2pmdRoomsShared(rooms, [roomKey('a'), roomKey('b')]), [
      { key: roomKey('a'), role: 'host', label: '', lastOpenedAt: 2, shared: true },
      { key: roomKey('b'), role: 'client', label: '', lastOpenedAt: 1 }
    ])
    // Nothing to change returns the same list, so nothing is written.
    assert.equal(markP2pmdRoomsShared(rooms, []), rooms)
    assert.equal(markP2pmdRoomsShared(rooms, [roomKey('b')]), rooms)
  })
})

describe('P2PMD note links', () => {
  test('an hs:// address is a note key', () => {
    assert.equal(parseP2pmdNoteLink(roomKey('a')), roomKey('a'))
    assert.equal(parseP2pmdNoteLink(`  HS://${'B'.repeat(52)}  `), `hs://${'B'.repeat(52)}`)
  })

  test('a bare key is not an address', () => {
    assert.equal(parseP2pmdNoteLink('a'.repeat(52)), null)
    assert.equal(parseP2pmdNoteLink('peersky'), null)
    assert.equal(parseP2pmdNoteLink('https://example.com'), null)
    assert.equal(parseP2pmdNoteLink(''), null)
    assert.equal(parseP2pmdNoteLink(null), null)
  })

  test('an hs:// address that is not a key opens nothing', () => {
    assert.equal(parseP2pmdNoteLink('hs://not a key'), null)
    assert.equal(parseP2pmdNoteLink('hs://'), null)
    assert.equal(parseP2pmdNoteLink(`hs://${'a'.repeat(400)}`), null)
  })
})

function createMemoryFile () {
  let value = null

  return {
    get exists () {
      return value !== null
    },
    get size () {
      return value?.length || 0
    },
    create: () => {
      value = ''
    },
    textSync: () => value,
    write: (nextValue) => {
      value = nextValue
    }
  }
}

// Five was fine until people kept notes for longer. Thirty fit, and past ten
// a name finds one faster than scrolling.
describe('a longer list of recent notes', () => {
  test('keeps thirty, and searches past ten', () => {
    assert.equal(MAX_P2PMD_RECENT_ROOMS, 30)
    assert.equal(P2PMD_RECENT_SEARCH_AFTER, 10)
    // Thirty entries with the longest labels still fit the file.
    const rooms = Array.from({ length: 30 }, (_, index) => ({
      key: `hs://s000${String(index).padStart(2, '0').repeat(26)}`,
      role: 'host',
      label: '\u{1F600}'.repeat(64),
      lastOpenedAt: index
    }))
    assert.ok(new TextEncoder().encode(serializeP2pmdRoomHistory(rooms)).byteLength < MAX_P2PMD_ROOM_HISTORY_FILE_BYTES)
  })

  test('finds a note by its name or its key, in any case', () => {
    const rooms = [
      { key: roomKey('a'), label: 'Note - Trip plans' },
      { key: roomKey('b'), label: 'Slides - Pitch' },
      { key: 'hs://s000zz', label: '' }
    ]
    assert.deepEqual(filterP2pmdRoomHistory(rooms, 'trip').map((room) => room.key), [roomKey('a')])
    assert.deepEqual(filterP2pmdRoomHistory(rooms, 'SLIDES').map((room) => room.key), [roomKey('b')])
    assert.deepEqual(filterP2pmdRoomHistory(rooms, 's000zz').map((room) => room.key), ['hs://s000zz'])
    assert.equal(filterP2pmdRoomHistory(rooms, '  '), rooms)
  })

  test('tells a private note from a public one by its key', () => {
    assert.equal(isPrivateP2pmdNoteKey(`hs://s000${'a'.repeat(52)}`), true)
    assert.equal(isPrivateP2pmdNoteKey(`hs://0000${'a'.repeat(52)}`), false)
    assert.equal(isPrivateP2pmdNoteKey(null), false)
  })

  test('each row starts with a lock or a globe, and the box shows past ten', async () => {
    const { readFile } = await import('node:fs/promises')
    const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(app, /\{p2pmdRoomHistory\.length > P2PMD_RECENT_SEARCH_AFTER && \(\s+<TextInput\s+accessibilityLabel='Search recent notes'/)
    assert.match(app, /const PrivacyIcon = isPrivate \? ShieldLockIcon : GlobeIcon/)
    const row = app.slice(app.indexOf('const PrivacyIcon'), app.indexOf("{room.role === 'host' ? 'Reopen' : 'Join'}"))
    assert.ok(row.indexOf('<PrivacyIcon') < row.indexOf('styles.p2pmdRecentRoomKey'))
  })
})
