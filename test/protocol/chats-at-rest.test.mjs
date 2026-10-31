import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'
import b4a from 'b4a'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'

import { createArchiveReader, createArchiveWriter } from '../../backend/backup/backup-archive.mjs'
import { readPrivateAppFile, sealChatFilesAtRest, writePrivateAppFile } from '../../backend/hyper/private-app-files.mjs'
import {
  getChatSealKeyState,
  isChatSealedFile,
  openSealedForBackup,
  readSealedJson,
  resetChatSealKey,
  sealFilesAtRest,
  sealJson,
  setChatSealKey,
  setLocalSealKey,
  waitForChatSealKey,
  writeSealedJson
} from '../../backend/hyper/sealed-file.mjs'
import {
  loadP2pmdRoomSnapshot,
  p2pmdSnapshotFileName,
  saveP2pmdRoomSnapshot,
  sealP2pmdSnapshotsAtRest
} from '../../backend/p2pmd/snapshots.mjs'
import {
  legacyRoomLogName,
  listStoredRoomLogs,
  moveLegacyRoomLog,
  roomLogName,
  sealedEntryEncoding
} from '../../backend/peerchat/room-log.mjs'
import { PeerChatService } from '../../backend/peerchat/service.mjs'
import { decideChatSealKey } from '../../app/privacy/chat-seal-key-state.mjs'

// A phone that was unlocked once since it started and is locked now is what
// forensic tools read. Chats and notes are locked with a key the phone gives
// only while it is unlocked, so a copy of its files shows none of them.

const CHAT_KEY = 'c7'.repeat(32)
const LOCAL_KEY = '1a'.repeat(32)
const ROOM_KEY = 'ab'.repeat(32)
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')

afterEach(() => {
  resetChatSealKey()
  setLocalSealKey('')
})

// Each folder's stores close before the folder goes.
const storesIn = new Map()

async function tempDir (t, name) {
  const dir = await mkdtemp(path.join(tmpdir(), `peersky-at-rest-${name}-`))
  t.after(async () => {
    for (const store of storesIn.get(dir) || []) await store.close().catch(() => {})
    storesIn.delete(dir)
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

function createSdk (store) {
  const drives = new Map()
  return {
    publicKey: Buffer.alloc(32, 5),
    swarm: Object.assign(new EventEmitter(), { flush: async () => {} }),
    localSwarm: new EventEmitter(),
    corestore: store,
    namespace: (name) => store.namespace(name),
    async getDrive (name) {
      if (!drives.has(name)) {
        const drive = new Hyperdrive(store.namespace(name))
        await drive.ready()
        drives.set(name, drive)
      }
      return drives.get(name)
    },
    join () {},
    async leave () {}
  }
}

function openStore (t, storagePath) {
  const store = new Corestore(path.join(storagePath, 'store'))
  storesIn.set(storagePath, [...(storesIn.get(storagePath) || []), store])
  return store
}

// Every key and value the store holds, searched for each text.
async function storeValuesWith (store, texts) {
  const found = []
  for await (const { key, value } of store.storage.db.iterator({})) {
    for (const text of texts) {
      if (b4a.from(key).includes(b4a.from(text)) || (value && b4a.from(value).includes(b4a.from(text)))) found.push(text)
    }
  }
  return found
}

async function rawEntries (store, name) {
  const log = store.get({ name })
  await log.ready()
  const entries = []
  for (let index = 0; index < log.length; index += 1) entries.push(await log.get(index))
  await log.close()
  return entries
}

describe('the chat key', () => {
  it('locks chats and notes apart from the local seal key', async (t) => {
    const dir = await tempDir(t, 'keys')
    setLocalSealKey(LOCAL_KEY)
    setChatSealKey(CHAT_KEY)
    const file = path.join(dir, 'chat.json')
    writeSealedJson(file, { secret: 'hello' }, { seal: 'chat' })
    const text = readFileSync(file, 'utf8')
    assert.match(text, /^\{"peersky-sealed":1,"key":"chat","nonce":"[0-9a-f]{48}","box":"/)
    assert.equal(text.includes('hello'), false)
    assert.equal(isChatSealedFile(file), true)
    assert.deepEqual(readSealedJson(file).value, { secret: 'hello' })

    // The local key alone does not open it.
    resetChatSealKey()
    assert.throws(() => readSealedJson(file), { code: 'SEALED_FILE_LOCKED' })
    // Nor does the chat key open a file the local key locked.
    setChatSealKey(CHAT_KEY)
    setLocalSealKey('')
    writeSealedJson(path.join(dir, 'local.json'), { a: 1 })
    assert.equal(isChatSealedFile(path.join(dir, 'local.json')), false)
  })

  it('writes nothing while the phone is locked, and waits for the unlock', async (t) => {
    const dir = await tempDir(t, 'locked')
    setChatSealKey('', { state: 'locked' })
    assert.equal(getChatSealKeyState(), 'locked')
    assert.throws(() => sealJson({ a: 1 }, { seal: 'chat' }), { code: 'CHAT_KEY_LOCKED' })
    assert.throws(() => writeSealedJson(path.join(dir, 'a.json'), { a: 1 }, { seal: 'chat' }), { code: 'CHAT_KEY_LOCKED' })
    assert.equal(existsSync(path.join(dir, 'a.json')), false)

    let opened = false
    const waiting = waitForChatSealKey().then(() => { opened = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(opened, false)
    // Told locked again, as each start with the phone locked says: still
    // waiting.
    setChatSealKey('', { state: 'locked' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(opened, false)
    setChatSealKey(CHAT_KEY)
    await waiting
    assert.equal(opened, true)
    writeSealedJson(path.join(dir, 'a.json'), { a: 1 }, { seal: 'chat' })
    assert.equal(isChatSealedFile(path.join(dir, 'a.json')), true)
  })

  it('refuses for good when the key made here is gone, and plain when none could be kept', async (t) => {
    const dir = await tempDir(t, 'missing')
    setChatSealKey('', { state: 'missing' })
    await assert.rejects(waitForChatSealKey(), { code: 'CHAT_KEY_MISSING' })
    assert.throws(() => sealJson({ a: 1 }, { seal: 'chat' }), { code: 'CHAT_KEY_MISSING' })

    // A phone whose secure storage cannot keep one writes as it always did,
    // in one line.
    resetChatSealKey()
    setChatSealKey('', { state: 'unavailable' })
    await waitForChatSealKey()
    writeSealedJson(path.join(dir, 'plain.json'), { b: 1 }, { seal: 'chat' })
    assert.equal(readFileSync(path.join(dir, 'plain.json'), 'utf8'), '{"b":1}')
  })

  it('keeps the key it was given, whatever comes after', () => {
    assert.equal(setChatSealKey(CHAT_KEY), true)
    assert.equal(setChatSealKey('d8'.repeat(32)), false)
    assert.equal(setChatSealKey('', { state: 'locked' }), true)
    assert.equal(getChatSealKeyState(), 'ready')
    assert.match(sealJson({ a: 1 }, { seal: 'chat' }), /"key":"chat"/)
  })

  it('locks plain chat files at rest and leaves locked ones alone', async (t) => {
    const dir = await tempDir(t, 'at-rest')
    setChatSealKey(CHAT_KEY)
    const plain = path.join(dir, 'plain.json')
    const sealed = path.join(dir, 'sealed.json')
    writeFileSync(plain, JSON.stringify({ rooms: [ROOM_KEY] }))
    writeSealedJson(sealed, { rooms: [] }, { seal: 'chat' })
    const before = readFileSync(sealed, 'utf8')
    assert.deepEqual(sealFilesAtRest([plain, sealed, path.join(dir, 'none.json')], { seal: 'chat' }), [plain])
    assert.equal(readFileSync(plain, 'utf8').includes(ROOM_KEY), false)
    assert.deepEqual(readSealedJson(plain).value, { rooms: [ROOM_KEY] })
    assert.equal(readFileSync(sealed, 'utf8'), before)
  })

  it('goes into a backup unlocked, since the phone it lands on has a key of its own', async (t) => {
    const dir = await tempDir(t, 'backup')
    setChatSealKey(CHAT_KEY)
    const file = path.join(dir, 'peerchat-mobile.json')
    writeSealedJson(file, { profile: { username: 'Ada' } }, { seal: 'chat' })
    assert.deepEqual(JSON.parse(b4a.toString(openSealedForBackup(readFileSync(file), 'peerchat-mobile.json'))), { profile: { username: 'Ada' } })

    // Bigger than the old 4 MiB limit, as PeerChat's file and P2PMD's copies
    // of notes can be.
    const big = path.join(dir, 'big.json')
    writeSealedJson(big, { text: 'x'.repeat(5 * 1024 * 1024) }, { seal: 'chat' })
    const plainBig = path.join(dir, 'plain-big.json')
    writeFileSync(plainBig, JSON.stringify({ text: 'y'.repeat(1024) }))
    const chunks = []
    const writer = createArchiveWriter(async (bytes) => { chunks.push(b4a.from(bytes)) })
    assert.equal(await writer.addFile('big.json', big), true)
    assert.equal(await writer.addFile('plain-big.json', plainBig), true)
    await writer.end()
    const files = new Map()
    let current = ''
    const reader = createArchiveReader({
      onFileStart: (name) => { current = name; files.set(name, []) },
      onFileData: (bytes) => { files.get(current).push(b4a.from(bytes)) }
    })
    await reader.push(b4a.concat(chunks))
    reader.finish()
    assert.equal(JSON.parse(b4a.toString(b4a.concat(files.get('big.json')))).text.length, 5 * 1024 * 1024)
    assert.equal(b4a.toString(b4a.concat(files.get('plain-big.json'))), readFileSync(plainBig, 'utf8'))
  })
})

describe('what the app does with what the system gives back', () => {
  it('never makes a key over one made here, and waits while the phone is locked', () => {
    const check = 'f'.repeat(32)
    const key = 'e'.repeat(64)
    assert.equal(decideChatSealKey({ read: 'ok', storedKey: null, check: null, sealedFiles: false }), 'make')
    assert.equal(decideChatSealKey({ read: 'ok', storedKey: key, storedKeyCheck: check, check, sealedFiles: false }), 'use')
    assert.equal(decideChatSealKey({ read: 'ok', storedKey: key, storedKeyCheck: 'a'.repeat(32), check, sealedFiles: false }), 'missing')
    assert.equal(decideChatSealKey({ read: 'ok', storedKey: null, check, sealedFiles: false }), 'missing')
    assert.equal(decideChatSealKey({ read: 'ok', storedKey: null, check: null, sealedFiles: true }), 'missing')
    // Locked, the key comes at the unlock; nothing is made in its place.
    assert.equal(decideChatSealKey({ read: 'locked', check: null, sealedFiles: false }), 'locked')
    assert.equal(decideChatSealKey({ read: 'locked', check, sealedFiles: false }), 'locked')
    assert.equal(decideChatSealKey({ read: 'gone', check, sealedFiles: false }), 'missing')
    // Unknown is tried again, never a reason to make one.
    assert.equal(decideChatSealKey({ read: 'error', check, sealedFiles: false }), 'locked')
    assert.equal(decideChatSealKey({ read: 'error', check: null, sealedFiles: false }), 'unavailable')
  })
})

describe('PeerChat with the chat key', () => {
  it('keeps no room key, name or message in the open', async (t) => {
    setChatSealKey(CHAT_KEY)
    const storagePath = await tempDir(t, 'peerchat')
    const store = openStore(t, storagePath)
    const sdk = createSdk(store)
    const service = await new PeerChatService({ sdk, storagePath }).start()
    service.setProfile({ username: 'Ada', bio: 'Hello' })
    await service.joinRoom({ roomKey: ROOM_KEY })
    await service.sendMessage({ roomKey: ROOM_KEY, message: 'Meet at the lake' })
    await service.close()

    const state = readFileSync(service.stateFilePath, 'utf8')
    assert.equal(isChatSealedFile(service.stateFilePath), true)
    for (const secret of [ROOM_KEY, 'Ada', 'Hello']) assert.equal(state.includes(secret), false, secret)

    // No name in the store says which room, and no entry is readable.
    const logs = await listStoredRoomLogs(store)
    assert.deepEqual(logs.map(({ name }) => name), [roomLogName(ROOM_KEY)])
    assert.equal(roomLogName(ROOM_KEY).includes(ROOM_KEY.slice(0, 16)), false)
    const entries = await rawEntries(store, roomLogName(ROOM_KEY))
    assert.ok(entries.length > 0)
    for (const entry of entries) {
      assert.throws(() => JSON.parse(b4a.toString(entry)))
      assert.equal(b4a.toString(entry).includes(service.localId), false)
    }

    // The next start opens all of it again.
    const again = await new PeerChatService({ sdk, storagePath }).start()
    t.after(() => again.close())
    assert.equal(again.getProfile().username, 'Ada')
    const { messages } = await again.readMessages(ROOM_KEY)
    assert.ok(messages.some((message) => message.message === 'Meet at the lake'))
  })

  it('does not start without the key, and leaves its file as it was', async (t) => {
    setChatSealKey(CHAT_KEY)
    const storagePath = await tempDir(t, 'no-key')
    const store = openStore(t, storagePath)
    const sdk = createSdk(store)
    const service = await new PeerChatService({ sdk, storagePath }).start()
    service.setProfile({ username: 'Ada' })
    await service.close()
    const before = readFileSync(service.stateFilePath, 'utf8')

    resetChatSealKey()
    await assert.rejects(new PeerChatService({ sdk, storagePath }).start(), { code: 'SEALED_FILE_LOCKED' })
    assert.equal(readFileSync(service.stateFilePath, 'utf8'), before)
  })

  it('moves a room log an earlier build kept under the room key, and locks its file', async (t) => {
    // What an earlier build left: its file in the open, and the room's
    // messages in a log named after the room key, made here by a PeerChat
    // with no chat key whose entries are copied across as they were.
    const sourcePath = await tempDir(t, 'source')
    const sourceStore = openStore(t, sourcePath)
    const source = await new PeerChatService({ sdk: createSdk(sourceStore), storagePath: sourcePath }).start()
    source.setProfile({ username: 'Ada' })
    await source.joinRoom({ roomKey: ROOM_KEY })
    await source.sendMessage({ roomKey: ROOM_KEY, message: 'From before' })
    await source.close()
    const sourceState = JSON.parse(readFileSync(source.stateFilePath, 'utf8'))
    const log = sourceStore.get({ name: roomLogName(ROOM_KEY), valueEncoding: sealedEntryEncoding(sourceState.logKey) })
    await log.ready()
    const oldEntries = []
    for (let index = 0; index < log.length; index += 1) oldEntries.push(await log.get(index))
    await log.close()

    const storagePath = await tempDir(t, 'legacy')
    const store = openStore(t, storagePath)
    const legacy = store.get({ name: legacyRoomLogName(ROOM_KEY), valueEncoding: 'json' })
    await legacy.append(oldEntries)
    await legacy.close()
    const { logKey, ...oldState } = sourceState
    writeFileSync(path.join(storagePath, 'peerchat-mobile.json'), JSON.stringify(oldState))

    setChatSealKey(CHAT_KEY)
    const service = await new PeerChatService({ sdk: createSdk(store), storagePath }).start()
    t.after(() => service.close())
    // Locked as it starts, with a log key of its own.
    assert.equal(isChatSealedFile(service.stateFilePath), true)
    assert.notEqual(service.logKey, logKey)
    const { messages } = await service.readMessages(ROOM_KEY)
    assert.ok(messages.some((message) => message.message === 'From before'))
    // The old log, its entries and its name are gone, from the store itself
    // too: nothing in it still holds an old entry in the open.
    assert.deepEqual((await listStoredRoomLogs(store)).map(({ name }) => name), [roomLogName(ROOM_KEY)])
    assert.equal(await store.storage.getAlias({ name: legacyRoomLogName(ROOM_KEY), namespace: store.ns }), null)
    assert.deepEqual(await storeValuesWith(store, [`"id":"${oldEntries.find((entry) => entry.ct)?.id}"`, '"sn":"Ada"', ROOM_KEY]), [])
    // New messages go to the new log.
    await service.sendMessage({ roomKey: ROOM_KEY, message: 'And now' })
    assert.equal((await rawEntries(store, roomLogName(ROOM_KEY))).length, oldEntries.length + 1)
  })

  it('moves the logs of rooms left earlier too, and drops emptied ones', async (t) => {
    setChatSealKey(CHAT_KEY)
    const storagePath = await tempDir(t, 'left')
    const store = openStore(t, storagePath)
    const left = 'cd'.repeat(32)
    const emptied = 'ef'.repeat(32)
    const leftLog = store.get({ name: legacyRoomLogName(left), valueEncoding: 'json' })
    await leftLog.append({ id: 'old', ct: 'sealed', ts: 1 })
    await leftLog.close()
    const emptiedLog = store.get({ name: legacyRoomLogName(emptied), valueEncoding: 'json' })
    await emptiedLog.ready()
    await emptiedLog.close()

    const service = await new PeerChatService({ sdk: createSdk(store), storagePath }).start()
    t.after(() => service.close())
    await service.moveLeftRoomLogs()
    assert.deepEqual((await listStoredRoomLogs(store)).map(({ name }) => name), [roomLogName(left)])
    const moved = store.get({ name: roomLogName(left), valueEncoding: sealedEntryEncoding(service.logKey) })
    await moved.ready()
    assert.deepEqual(await moved.get(0), { id: 'old', ct: 'sealed', ts: 1 })
    await moved.close()
  })

  it('starts a move cut short over, and never copies twice over newer messages', async (t) => {
    const storagePath = await tempDir(t, 'move')
    const store = openStore(t, storagePath)
    const logKey = 'a1'.repeat(32)
    const encoding = sealedEntryEncoding(logKey)
    const legacy = store.get({ name: legacyRoomLogName(ROOM_KEY), valueEncoding: 'json' })
    await legacy.append([{ id: '1' }, { id: '2' }, { id: '3' }])
    await legacy.close()
    // Cut short after one entry.
    const partial = store.get({ name: roomLogName(ROOM_KEY), valueEncoding: encoding })
    await partial.append({ id: '1' })
    await partial.close()

    assert.equal(await moveLegacyRoomLog(store, ROOM_KEY, logKey), true)
    const log = store.get({ name: roomLogName(ROOM_KEY), valueEncoding: encoding })
    await log.ready()
    assert.deepEqual([await log.get(0), await log.get(1), await log.get(2)], [{ id: '1' }, { id: '2' }, { id: '3' }])
    assert.equal(log.length, 3)
    await log.close()
    assert.equal(await moveLegacyRoomLog(store, ROOM_KEY, logKey), false)

    // An old log still there at a later start, beside a whole copy with
    // newer messages after it, only goes.
    await store.close()
    const later = openStore(t, storagePath)
    const again = later.get({ name: legacyRoomLogName(ROOM_KEY), valueEncoding: 'json' })
    await again.append([{ id: '1' }, { id: '2' }])
    await again.close()
    assert.equal(await moveLegacyRoomLog(later, ROOM_KEY, logKey), true)
    const kept = later.get({ name: roomLogName(ROOM_KEY), valueEncoding: encoding })
    await kept.ready()
    assert.equal(kept.length, 3)
    await kept.close()
    assert.equal(await later.storage.getAlias({ name: legacyRoomLogName(ROOM_KEY), namespace: later.ns }), null)
  })
})

describe('P2PMD with the chat key', () => {
  const noteKey = `hs://s000${'k'.repeat(48)}`

  it('keeps a note\'s copy under a hash of its key, locked', async (t) => {
    setChatSealKey(CHAT_KEY)
    const storagePath = await tempDir(t, 'notes')
    assert.equal(saveP2pmdRoomSnapshot(noteKey, { content: 'Our plan', lineAttributions: {}, updatedAt: 1 }, storagePath), true)
    const names = readdirSync(path.join(storagePath, 'p2pmd-rooms'))
    assert.deepEqual(names, [p2pmdSnapshotFileName(noteKey)])
    assert.equal(names[0].includes('kkkk'), false)
    const file = path.join(storagePath, 'p2pmd-rooms', names[0])
    assert.equal(isChatSealedFile(file), true)
    assert.equal(readFileSync(file, 'utf8').includes('Our plan'), false)
    assert.equal(loadP2pmdRoomSnapshot(noteKey, storagePath).content, 'Our plan')

    // While the phone is locked after a start, nothing is written.
    resetChatSealKey()
    setChatSealKey('', { state: 'locked' })
    assert.equal(saveP2pmdRoomSnapshot(noteKey, { content: 'Lost', lineAttributions: {}, updatedAt: 2 }, storagePath), false)
  })

  it('moves the copies an earlier build kept under the note keys', async (t) => {
    const storagePath = await tempDir(t, 'legacy-notes')
    const directory = path.join(storagePath, 'p2pmd-rooms')
    await mkdir(directory, { recursive: true })
    const legacyName = `${noteKey.slice('hs://'.length)}.json`
    writeFileSync(path.join(directory, legacyName), JSON.stringify({ version: 1, key: noteKey, content: 'Kept', lineAttributions: {}, updatedAt: 3 }))
    writeFileSync(path.join(directory, `${legacyName}.previous`), JSON.stringify({ version: 1, key: noteKey, content: 'Older', lineAttributions: {}, updatedAt: 2 }))
    const other = `hs://s000${'m'.repeat(48)}`
    writeFileSync(path.join(directory, `${other.slice('hs://'.length)}.json`), JSON.stringify({ version: 1, key: other, content: 'Second', lineAttributions: {}, updatedAt: 4 }))

    setChatSealKey(CHAT_KEY)
    assert.equal(sealP2pmdSnapshotsAtRest(storagePath), 2)
    assert.deepEqual(readdirSync(directory).sort(), [p2pmdSnapshotFileName(noteKey), p2pmdSnapshotFileName(other)].sort())
    assert.equal(loadP2pmdRoomSnapshot(noteKey, storagePath).content, 'Kept')
    assert.equal(loadP2pmdRoomSnapshot(other, storagePath).content, 'Second')
    for (const name of readdirSync(directory)) assert.equal(isChatSealedFile(path.join(directory, name)), true)
  })

  it('reads an old copy as it opens the note, and moves it then', async (t) => {
    setChatSealKey(CHAT_KEY)
    const storagePath = await tempDir(t, 'legacy-open')
    const directory = path.join(storagePath, 'p2pmd-rooms')
    await mkdir(directory, { recursive: true })
    writeFileSync(path.join(directory, `${noteKey.slice('hs://'.length)}.json`), JSON.stringify({ version: 1, key: noteKey, content: 'Old copy', lineAttributions: {}, updatedAt: 3 }))
    assert.equal(loadP2pmdRoomSnapshot(noteKey, storagePath).content, 'Old copy')
    assert.deepEqual(readdirSync(directory), [p2pmdSnapshotFileName(noteKey)])
  })
})

describe('the app\'s own files with chats and notes', () => {
  it('are read and written through the backend, locked, and an old one is locked as it is read', async (t) => {
    setChatSealKey(CHAT_KEY)
    const documentsPath = await tempDir(t, 'documents')
    const history = path.join(documentsPath, 'p2pmd-room-history.json')
    writeFileSync(history, JSON.stringify({ items: [{ key: 'hs://s000abc', role: 'host', lastOpenedAt: 1 }] }))
    const opened = await readPrivateAppFile({ name: 'p2pmd-room-history.json' }, { documentsPath })
    assert.equal(opened.ok, true)
    assert.equal(JSON.parse(opened.text).items[0].key, 'hs://s000abc')
    assert.equal(isChatSealedFile(history), true)

    const drafts = JSON.stringify({ activeRoomKey: ROOM_KEY, drafts: { [ROOM_KEY]: 'half a thought' } })
    assert.deepEqual(await writePrivateAppFile({ name: 'peerchat-ui-state.json', text: drafts }, { documentsPath }), { ok: true })
    const uiState = readFileSync(path.join(documentsPath, 'peerchat-ui-state.json'), 'utf8')
    assert.equal(uiState.includes('half a thought') || uiState.includes(ROOM_KEY), false)
    assert.equal((await readPrivateAppFile({ name: 'peerchat-ui-state.json' }, { documentsPath })).text, drafts)
    assert.deepEqual(await readPrivateAppFile({ name: 'none.json' }, { documentsPath }), { ok: false, error: 'Not one of the app\'s private files.' })
    assert.deepEqual((await readPrivateAppFile({ name: 'p2pmd-profile.json' }, { documentsPath })).ok, false)
    assert.deepEqual(await readPrivateAppFile({ name: 'peerchat-ui-state.json' }, { documentsPath: path.join(documentsPath, 'empty') }), { ok: true, text: null })
  })

  it('wait for the unlock rather than read or write without the key', async (t) => {
    const documentsPath = await tempDir(t, 'documents-locked')
    setChatSealKey('', { state: 'locked' })
    let written = false
    const writing = writePrivateAppFile({ name: 'peerchat-ui-state.json', text: '{"drafts":{}}' }, { documentsPath }).then(() => { written = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(written, false)
    assert.equal(existsSync(path.join(documentsPath, 'peerchat-ui-state.json')), false)
    setChatSealKey(CHAT_KEY)
    await writing
    assert.equal(isChatSealedFile(path.join(documentsPath, 'peerchat-ui-state.json')), true)
  })

  it('are all locked at rest once the key is here', async (t) => {
    const documentsPath = await tempDir(t, 'documents-rest')
    const hyperStoragePath = path.join(documentsPath, 'hyper-sdk')
    await mkdir(hyperStoragePath, { recursive: true })
    const plain = {
      [path.join(hyperStoragePath, 'peerchat-mobile.json')]: { rooms: [{ roomKey: ROOM_KEY }] },
      [path.join(hyperStoragePath, 'p2pmd-ports.json')]: { version: 1, notes: {} },
      [path.join(hyperStoragePath, 'p2pmd-public-notes.json')]: { version: 1, notes: {} },
      [path.join(documentsPath, 'peerchat-ui-state.json')]: { drafts: {} },
      [path.join(documentsPath, 'p2pmd-room-history.json')]: { items: [] }
    }
    for (const [file, value] of Object.entries(plain)) writeFileSync(file, JSON.stringify(value))

    // Not before the key is here.
    assert.deepEqual(sealChatFilesAtRest({ documentsPath, hyperStoragePath }), { sealed: [], moved: 0 })
    setChatSealKey(CHAT_KEY)
    assert.equal(sealChatFilesAtRest({ documentsPath, hyperStoragePath }).sealed.length, 5)
    for (const [file, value] of Object.entries(plain)) {
      assert.equal(isChatSealedFile(file), true, file)
      assert.deepEqual(readSealedJson(file).value, value)
    }
  })
})

describe('the app and the native code around the key', () => {
  it('asks the iOS Keychain for a key it gives only while the phone is unlocked', () => {
    const app = read('app/privacy/chat-seal-key.ts')
    assert.match(app, /keychainAccessible: SecureStore\.WHEN_UNLOCKED_THIS_DEVICE_ONLY/)
    assert.match(app, /const ITEM = 'peersky\.chat-seal-key'/)
    // Read before asking the system, and made only when the state says so.
    assert.ok(app.indexOf('const check = readCheck(checkFile)') < app.indexOf('await readKey()'))
    assert.equal(app.match(/getRandomBytes\(32\)/g)?.length, 1)
    assert.match(app, /interaction is not allowed\|-25308/)
  })

  it('wraps it on Android with a Keystore key that needs the phone unlocked, from Android 15', () => {
    const module = read('plugins/templates/PeerSkyChatKeyModule.kt.template')
    assert.match(module, /if \(unlockBound && Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.P\) builder\.setUnlockedDeviceRequired\(true\)/)
    assert.match(module, /private const val UNLOCK_BOUND_FROM = 35/)
    assert.match(module, /private fun wantsUnlockBound\(\) = Build\.VERSION\.SDK_INT >= UNLOCK_BOUND_FROM/)
    // Never made over one there is, and a refusal says why.
    assert.match(module, /if \(wrappedFile\(\)\.exists\(\)\) \{\s+promise\.reject\("EXISTS"/)
    assert.match(module, /promise\.reject\(if \(locked\) "LOCKED" else "UNREADABLE"/)
    assert.match(module, /catch \(error: KeyPermanentlyInvalidatedException\) \{\s+promise\.reject\("GONE"/)
    // Wrapped again once the phone is on Android 15, and the key stays.
    assert.match(module, /if \(wantsUnlockBound\(\) && !wrapped\.optBoolean\("unlockBound", false\)\)/)
    assert.match(module, /File\(reactApplicationContext\.noBackupFilesDir, FILE_NAME\)/)
    assert.match(read('plugins/templates/PeerChatBackgroundPackage.kt.template'), /PeerSkyChatKeyModule\(reactContext\)/)
    assert.match(read('plugins/with-peerchat-background.js'), /'PeerSkyChatKeyModule\.kt'/)
  })

  it('hands it to the backend as it starts, and again at the unlock', () => {
    const backend = read('app/backend.ts')
    assert.match(backend, /isLocalSealKeyMissing\(\) \? 'missing' : '',\s+chat\.key,\s+chat\.key \? '' : chat\.state\s+\]/)
    assert.match(backend, /callBackend\(RPC_CHAT_SEAL_KEY, \{ key: chat\.key, state: chat\.key \? '' : chat\.state \}\)/)
    assert.match(read('backend/main.mjs'), /setChatSealKey\(Bare\.argv\[3\], \{ state: Bare\.argv\[4\] \}\)/)
    const app = read('app/index.tsx')
    assert.match(app, /nextState === 'active' && previousState !== 'active' && rpcRef\.current[\s\S]{0,400}void syncChatSealKey\(\)/)
    // PeerChat waits for it rather than start with nothing.
    assert.match(read('backend/peerchat/runtime.mjs'), /if \(!service\) await waitForChatSealKey\(\)/)
    const router = read('backend/rpc/router.mjs')
    assert.match(router, /if \(req\.command === RPC_P2PMD_ROOM_CREATE\) \{\s+await waitForChatSealKey\(\)/)
    assert.match(router, /if \(req\.command === RPC_P2PMD_ROOM_JOIN\) \{\s+await waitForChatSealKey\(\)/)
  })

  it('says on Android that PeerChat connects at the unlock, and starts it then', () => {
    const task = read('app/peerchat/background-task.ts')
    assert.match(task, /const chat = await syncChatSealKey\(\)\n\s+if \(chat\.state === 'locked'\) \{\n\s+reportPeerChatLocked\(\)\n\s+return/)
    const service = read('plugins/templates/PeerChatBackgroundService.kt.template')
    assert.match(service, /STATUS_LOCKED -> getString\(R\.string\.peerchat_background_locked\)/)
    assert.match(service, /IntentFilter\(Intent\.ACTION_USER_PRESENT\)/)
    assert.match(service, /intent\?\.action != Intent\.ACTION_USER_PRESENT \|\| status == STATUS_CONNECTED\) return\n\s+taskStartedAt = 0L\n\s+startPeerChat\(\)/)
    assert.match(service, /value != STATUS_CONNECTED && value != STATUS_OFFLINE && value != STATUS_LOCKED/)
  })

  it('clears the pictures and files opened to show them before the phone locks', () => {
    const cache = read('app/peerchat/attachment-cache.ts')
    assert.match(cache, /if \(next === 'background' && Platform\.OS === 'ios'\) clearPeerChatAttachmentCache\(\)/)
    assert.match(cache, /addListener\('PeerSkyScreenOff', clearPeerChatAttachmentCache\)/)
    assert.match(read('plugins/templates/PeerSkyChatKeyModule.kt.template'), /IntentFilter\(Intent\.ACTION_SCREEN_OFF\)/)
    assert.match(read('app/index.tsx'), /useEffect\(\(\) => watchPeerChatAttachmentCache\(\), \[\]\)/)
    assert.match(read('backend/rpc/router.mjs'), /rmSync\(getAttachmentCacheDirectory\(\), \{ recursive: true, force: true \}\)/)
    // A picture on screen opens again when the app comes back.
    assert.match(read('app/peerchat/PeerChatScreen.tsx'), /\}, \[attachmentGeneration, canPreview, item\.fileEnc/)
  })

  it('never writes the app\'s files before reading them', () => {
    const screen = read('app/peerchat/PeerChatScreen.tsx')
    assert.match(screen, /function persistPeerChatUiState \(state: PeerChatUiState\) \{\n\s+if \(!uiStateRead\) return/)
    assert.ok(screen.indexOf('uiStateRead = true') > screen.indexOf('callBackend(RPC_PRIVATE_APP_FILE_READ, { name: PEERCHAT_UI_STATE_FILE })'))
    const app = read('app/index.tsx')
    assert.match(app, /function saveP2pmdRoomHistory \(rooms: P2pmdRoomHistoryEntry\[\]\) \{\n\s+if \(!p2pmdRoomHistoryRead\) return false/)
    assert.match(app, /await readP2pmdRoomHistoryOnce\(\)\n\s+const response = await callRpc\(RPC_P2PMD_TAKE_NOTES, \{\}\)/)
  })
})
