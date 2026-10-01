import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import * as commands from '../../backend/rpc/commands.mjs'
import { MIN_BACKUP_PASSPHRASE_LENGTH as BACKEND_MIN } from '../../backend/backup/phone-backup.mjs'
import {
  checkNewPassphrase,
  createBackupFileName,
  describeBackupContents,
  describeBackupOrigin,
  describeProgress,
  formatBackupSize,
  MIN_BACKUP_PASSPHRASE_LENGTH,
  parseProgressEvent,
  toBareFsPath
} from '../../app/settings/link-device-state.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('the screen and the backend agree on the passphrase length', () => {
  assert.equal(MIN_BACKUP_PASSPHRASE_LENGTH, BACKEND_MIN)
  assert.equal(checkNewPassphrase('short', 'short'), 'Use at least 12 characters.')
  assert.equal(checkNewPassphrase('long enough phrase', 'long enough phrasE'), 'The two passphrases do not match.')
  assert.equal(checkNewPassphrase('long enough phrase', 'long enough phrase'), null)
})

test('backup files get a dated name and paths reach the worklet as plain paths', () => {
  assert.equal(createBackupFileName(new Date(2026, 8, 29, 23, 59)), 'peersky-backup-2026-09-29.peersky')
  assert.equal(
    toBareFsPath('file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/peersky-backup%202026.peersky'),
    '/var/mobile/Containers/Data/Application/ABC/Library/Caches/peersky-backup 2026.peersky'
  )
  assert.equal(toBareFsPath('/already/a/path'), '/already/a/path')
})

test('what a backup holds is said the way a person would say it', () => {
  assert.equal(
    describeBackupContents(['browser-tabs.json', 'browser-bookmarks.json', 'browser-history.json', 'browser-preferences.json', 'hyper-sdk', 'hyper-sdk-synced-private']),
    'Tabs, bookmarks, history, settings, chats, notes, private files and files'
  )
  // A desktop transfer brings less, and says only that.
  assert.equal(
    describeBackupContents(['hyper-private', 'incoming-tabs.json', 'peersky-identity.json', 'privateHyperdrives.json']),
    'Tabs and private files'
  )
  // A desktop with no private drives still sends its key. That is not files.
  assert.equal(
    describeBackupContents(['incoming-bookmarks.json', 'incoming-tabs.json', 'peersky-identity.json', 'private-drive-key.json']),
    'Tabs and bookmarks'
  )
  // A desktop's PeerChat: the profile and rooms, which PeerChat takes on start.
  assert.equal(
    describeBackupContents(['incoming-tabs.json', 'peerchat-incoming.json', 'peersky-identity.json']),
    'Tabs and chats'
  )
  // And their recent P2PMD notes.
  assert.equal(
    describeBackupContents(['incoming-tabs.json', 'p2pmd-incoming.json', 'peersky-identity.json']),
    'Tabs and notes'
  )
  assert.equal(describeBackupContents(['browser-bookmarks.json']), 'Bookmarks')
  assert.equal(describeBackupContents([]), '')
  assert.equal(describeBackupContents(undefined), '')

  assert.equal(formatBackupSize(500), 'under 1 MB')
  assert.equal(formatBackupSize(120 * 1024 * 1024), '120 MB')
  assert.equal(formatBackupSize(2.5 * 1024 * 1024 * 1024), '2.5 GB')

  assert.equal(describeBackupOrigin({ createdAt: '2026-09-29T12:00:00.000Z', platform: 'ios' }), 'Made on an iPhone, September 29, 2026')
  assert.equal(describeBackupOrigin({ platform: 'android' }), 'Made on an Android phone')
  assert.equal(describeBackupOrigin({ createdAt: 'not a date' }), 'Made on a phone')
})

test('progress from the worklet becomes a label and a bar', () => {
  assert.deepEqual(describeProgress({ phase: 'packing', done: 25, total: 100 }), { label: 'Packing up your data', fraction: 0.25, detail: '25%' })
  assert.deepEqual(describeProgress({ phase: 'downloading', done: 5, total: null }), { label: 'Downloading from the other device', fraction: null, detail: '' })
  assert.equal(describeProgress({ phase: 'something new' }).label, 'Working')
  assert.deepEqual(parseProgressEvent('{"phase":"unpacking","done":3,"total":9}'), { phase: 'unpacking', done: 3, total: 9 })
  assert.equal(parseProgressEvent('not json'), null)
  assert.equal(parseProgressEvent('{"done":1}'), null)
})

test('every RPC command has its own number, and the router answers the new ones', async () => {
  const values = Object.entries(commands).filter(([name]) => name.startsWith('RPC_'))
  const seen = new Map()
  for (const [name, value] of values) {
    assert.equal(seen.has(value), false, `${name} reuses ${value}, already ${seen.get(value)}`)
    seen.set(value, name)
  }

  const router = await read('backend/rpc/router.mjs')
  for (const name of [
    'RPC_BACKUP_ESTIMATE',
    'RPC_BACKUP_CREATE',
    'RPC_BACKUP_INSPECT',
    'RPC_BACKUP_RESTORE_FILE',
    'RPC_IDENTITY_SEND',
    'RPC_IDENTITY_SEND_STOP',
    'RPC_IDENTITY_DISCARD_RESTORE'
  ]) {
    assert.match(router, new RegExp(`req\\.command === ${name}\\)`), `${name} is not routed`)
  }
})

// The screen a person sees: this device, one way to sync, a backup, the
// desktop app, and a way to let go of this phone. Nothing else.
test('Link Device is laid out like a sync screen, not a debug page', async () => {
  const screen = await read('app/settings/LinkDevice.tsx')
  const main = screen.slice(screen.indexOf('export function LinkDeviceSettings'), screen.indexOf('function SyncSheet'))

  // Sections and rows, in the order they appear.
  const titles = [...main.matchAll(/title='([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(titles, [
    'My devices',
    'Sync with another device',
    'Backup',
    'Save a backup file',
    'Restore from a backup file',
    'Download',
    'Get the desktop browser',
    'This phone',
    'Remove my data from this phone'
  ])
  assert.match(main, /title=\{Platform\.OS === 'ios' \? \(Platform\.isPad \? 'iPad' : 'iPhone'\) : 'Android phone'\}\s*trailing='This device'/)
  // The old page showed the key file's location and a hyper:// text field.
  assert.doesNotMatch(screen, /Identity key file location/)
  assert.doesNotMatch(screen, /placeholder='hyper:\/\/\.\.\.'/)

  const settings = await read('app/settings/SettingsScreen.tsx')
  assert.match(settings, /import \{ LinkDeviceSettings \} from '\.\/LinkDevice'/)
  assert.match(settings, /description: 'Sync with another device, or save a backup'/)
  assert.doesNotMatch(settings, /function LinkDeviceSettings/)
})

test('what the camera sees decides the direction', async () => {
  const screen = await read('app/settings/LinkDevice.tsx')
  const handle = screen.slice(screen.indexOf('async function handleCode'), screen.indexOf('async function receive'))

  assert.match(handle, /classifyLinkDeviceCode\(text\)/)
  assert.match(handle, /result\.kind === 'transfer' && result\.url\) \{\s*await receive\(result\.url\)/)
  // A desktop's code sends to the desktop: it takes the tabs and bookmarks.
  assert.match(handle, /if \(result\.code\) confirmSend\(result\.code, result\.deviceType === 'desktop'\)/)
  assert.doesNotMatch(handle, /send to this phone instead/)
})

test('sending to a desktop says what it gets and shows a link to paste there', async () => {
  const screen = await read('app/settings/LinkDevice.tsx')
  const confirm = screen.slice(screen.indexOf('function confirmSend'), screen.indexOf('async function send ('))
  assert.match(confirm, /'Send to PeerSky Desktop\?'/)
  assert.match(confirm, /the pages open on this phone and your bookmarks/)
  // The key to the phone's private drive goes too, so the person is told.
  assert.match(confirm, /can open your private files/)

  const sheet = screen.slice(screen.indexOf(': sending'), screen.indexOf('direction === \'receive\''))
  assert.match(sheet, /sending\.toDesktop \? 'Open this on the desktop'/)
  assert.match(sheet, /Under Restore from the network, paste this link or scan it/)
  assert.match(sheet, /onPress=\{copyLink\}/)
  assert.match(screen, /Clipboard\.setString\(sending\.url\)/)
})

test('a restore waits for the code to be compared, and a cancel frees the space', async () => {
  const screen = await read('app/settings/LinkDevice.tsx')

  for (const [start, end] of [
    ['function confirmRestore', 'function confirmSend'],
    ['async function restoreBackup', 'const passphraseProblem']
  ]) {
    const flow = screen.slice(screen.indexOf(start), screen.indexOf(end))
    assert.match(flow, /style: 'cancel',\s*onPress: \(\) => void call\(RPC_IDENTITY_DISCARD_RESTORE, \{ restoreId: response\.restoreId \}\)/)
    assert.match(flow, /onPress: \(\) => onConfirmRestore\(response\.restoreId\)/)
  }
  // The code the other device shows is the first thing in the question.
  assert.match(screen, /'Does the other device show this code\?',\s*`\$\{response\.sas\}/)
})

test('packing stops offline downloads, so the app starts them again', async () => {
  const screen = await read('app/settings/LinkDevice.tsx')
  for (const [start, end] of [
    ['async function send (', 'function copyCode'],
    ['async function createBackup ()', 'async function shareBackup']
  ]) {
    const flow = screen.slice(screen.indexOf(start), screen.indexOf(end))
    assert.match(flow, /finally \{[\s\S]*call\(RPC_HYPER_OFFLINE_RESUME_ALL\)/)
  }
})

test('a backup file is handed to the share sheet and not left behind', async () => {
  const screen = await read('app/settings/LinkDevice.tsx')
  const create = screen.slice(screen.indexOf('async function createBackup ()'), screen.indexOf('async function restoreBackup'))

  assert.match(create, /new File\(Paths\.cache, createBackupFileName\(\)\)/)
  assert.match(create, /outPath: toBareFsPath\(file\.uri\)/)
  assert.match(create, /Sharing\.shareAsync\(uri, \{/)
  const close = screen.slice(screen.indexOf('  function close () {\n    // The file only needs'), screen.indexOf('async function createBackup ()'))
  assert.match(close, /deleteCachedFile\(savedFileRef\.current\)/)
})

test('the worklet\'s progress reaches the settings screen', async () => {
  const app = await read('app/index.tsx')
  assert.match(app, /request\.command === RPC_APP_BACKUP_PROGRESS && request\.data/)
  assert.match(app, /emitLinkDeviceProgress\(/)
})
