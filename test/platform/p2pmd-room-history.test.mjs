import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  formatP2pmdRoomHistoryKey,
  MAX_P2PMD_ROOM_HISTORY_FILE_BYTES,
  MAX_P2PMD_RECENT_ROOMS,
  normalizeP2pmdRoomKey,
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
      { key: roomKey('a'), lastOpenedAt: 10 },
      { key: roomKey('b'), lastOpenedAt: 20 }
    ]

    assert.deepEqual(
      parseP2pmdRoomHistory(serializeP2pmdRoomHistory(rooms)),
      [rooms[1], rooms[0]]
    )
  })

  test('deduplicates reopened rooms and bounds the list like desktop', () => {
    let rooms = []
    for (let index = 0; index < MAX_P2PMD_RECENT_ROOMS + 2; index++) {
      rooms = recordP2pmdRoom(rooms, {
        key: roomKey(String.fromCharCode(97 + index)),
        lastOpenedAt: index
      })
    }

    rooms = recordP2pmdRoom(rooms, {
      key: roomKey('d'),
      lastOpenedAt: 100
    })

    assert.equal(rooms.length, MAX_P2PMD_RECENT_ROOMS)
    assert.equal(rooms[0].key, roomKey('d'))
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
  })

  test('formats room keys without exposing the full key in setup UI', () => {
    assert.equal(formatP2pmdRoomHistoryKey(roomKey('a')), `${'a'.repeat(20)}...`)
    assert.equal(formatP2pmdRoomHistoryKey('invalid'), '')
  })

  test('persists rooms for restart and rejects oversized files before reading', () => {
    const file = createMemoryFile()
    const rooms = [{ key: roomKey('a'), lastOpenedAt: 10 }]

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
