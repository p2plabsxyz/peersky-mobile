import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import b4a from 'b4a'
import sodium from 'sodium-native'
import { Writable } from 'streamx'
import { Transform } from 'bare-stream'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { getHyperRuntime, holdHyperStores } from '../../backend/hyper/runtime.mjs'
import {
  commitStagedRestore,
  recoverInterruptedRestore,
  RESTORE_PREVIOUS_DIR,
  RESTORE_STAGING_DIR,
  RESTORE_TRASH_DIR
} from '../../backend/backup/restore.mjs'
import { writeFileToDrive } from '../../backend/backup/transfer-publisher.mjs'
import { openZipFile } from '../../backend/backup/zip-file.mjs'
import { createArchiveWriter } from '../../backend/backup/backup-archive.mjs'
import {
  createPhoneBackup,
  createPhoneTransfer,
  PHONE_BACKUP_KIND,
  PHONE_TRANSFER_KIND,
  stagePhoneBackupFile
} from '../../backend/backup/phone-backup.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

async function tempDir (t) {
  const dir = await mkdtemp(join(tmpdir(), 'peersky-link-safety-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function listOf (...names) {
  return names.sort()
}

describe('keeping the stores shut while Link Device works on them', () => {
  // PeerChat polls every few seconds and opens the runtime directly, outside
  // the maintenance window. One poll landing mid-backup reopened the store
  // and rewrote the very files the backup was reading.
  it('nothing opens a store while they are held, and everything waits for the release', async () => {
    const release = holdHyperStores()
    let outcome = 'pending'
    getHyperRuntime().then(() => { outcome = 'opened' }, () => { outcome = 'went ahead' })

    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(outcome, 'pending')

    release()
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Under node there is no Bare to open with, so going ahead means failing
    // here. What matters is that it only went ahead once released.
    assert.equal(outcome, 'went ahead')
  })

  it('every step that reads or replaces the stores holds them for its whole length', async () => {
    const source = await read('backend/backup/link-device.mjs')
    const helper = source.slice(source.indexOf('function withStoresClosed (task) {'), source.indexOf('// At most four updates'))

    assert.ok(helper.indexOf('holdHyperStores()') < helper.indexOf('closeHyperRuntime()'))
    assert.ok(helper.indexOf('release()') < helper.indexOf('await getHyperRuntime()'))
    // The only way into a maintenance window is through that helper.
    assert.equal((source.match(/withHyperRuntimeMaintenance\(/g) || []).length, 1)
    for (const step of ['createPhoneBackup({', 'createPhoneTransfer({', 'commitStagedRestore({', 'rmSync(target, { recursive: true, force: true })']) {
      const at = source.indexOf(step)
      assert.ok(at > -1, step)
      assert.ok(source.lastIndexOf('withStoresClosed(', at) > source.lastIndexOf('\nexport ', at), `${step} runs outside withStoresClosed`)
    }
  })
})

describe('one Link Device job at a time', () => {
  it('packing, sending, receiving, unpacking, restoring and removing never overlap', async () => {
    const source = await read('backend/backup/link-device.mjs')
    for (const job of ['createBackupFile', 'restoreBackupFile', 'receiveTransfer', 'confirmRestore', 'sendTransfer', 'removeIdentity']) {
      const body = source.slice(source.indexOf(`export function ${job} (`), source.indexOf('\n}\n', source.indexOf(`export function ${job} (`)))
      assert.match(body, /return runExclusive\(async \(\) => \{/, `${job} is not exclusive`)
    }
  })

  // A cancel from one dialog, or a confirm from another that went stale, must
  // never act on a different restore than the one it was shown for.
  it('a confirmation lands only the restore it was shown for', async () => {
    const source = await read('backend/backup/link-device.mjs')
    const confirm = source.slice(source.indexOf('export function confirmRestore'), source.indexOf('export function sendTransfer'))
    assert.match(confirm, /pending\.id !== restoreId/)
    assert.match(confirm, /That restore is no longer waiting/)
    const discard = source.slice(source.indexOf('export function discardPendingRestore'), source.indexOf('export function confirmRestore'))
    assert.match(discard, /restoreId !== undefined && pending\.id !== restoreId/)

    const screen = await read('app/settings/LinkDevice.tsx')
    assert.equal((screen.match(/RPC_IDENTITY_DISCARD_RESTORE, \{ restoreId: response\.restoreId \}/g) || []).length, 4)
    assert.match(screen, /replaceData\(RPC_IDENTITY_CONFIRM_RESTORE, \{ restoreId \}/)
  })

  it('a sheet closed mid-way cleans up what comes back instead of acting on it', async () => {
    const screen = await read('app/settings/LinkDevice.tsx')
    const create = screen.slice(screen.indexOf('async function createBackup ()'), screen.indexOf('async function shareBackup'))
    assert.match(create, /if \(!visibleRef\.current\) \{\s*deleteCachedFile\(file\.uri\)\s*return/)
    const restore = screen.slice(screen.indexOf('async function restoreBackup ()'), screen.indexOf('const passphraseProblem'))
    assert.match(restore, /if \(!visibleRef\.current\) \{\s*void call\(RPC_IDENTITY_DISCARD_RESTORE/)
  })

  // The screens on show hold the old data, and PeerChat writes its state as
  // it closes. Freezing after the restore let that land over the new files.
  it('the app freezes before the data is replaced, not after', async () => {
    const screen = await read('app/settings/LinkDevice.tsx')
    const replace = screen.slice(screen.indexOf('const replaceData = useCallback'), screen.indexOf('const commitRestore = useCallback'))
    assert.ok(replace.indexOf('onRestartRequired()') < replace.indexOf('await call(command, data)'))
    assert.match(replace, /Nothing on this phone was changed/)
    assert.match(screen, /void replaceData\(RPC_IDENTITY_REMOVE, \{\}, 'Your data was not removed'\)/)
  })

  // Found on a simulator: the restart screen never showed. Link Device is in
  // Settings, which the app returned before it looked at restartRequired, and
  // the sheet the confirmation came from stayed up over everything.
  it('the restart screen comes before every other screen, with the sheet closed first', async () => {
    const app = await read('app/index.tsx')
    const restart = app.indexOf('if (restartRequired) {')
    assert.ok(restart > 0)
    for (const screen of ['if (browserBookmarksVisible) {', 'browserHistoryVisible) {', 'browserDownloadsVisible) {', 'browserSettingsVisible) {', 'if (!browserSessionReady) {', 'if (showWelcome) {']) {
      assert.ok(app.indexOf(screen) > restart, `${screen} is checked before the restart screen`)
    }

    const screen = await read('app/settings/LinkDevice.tsx')
    const replace = screen.slice(screen.indexOf('const replaceData = useCallback'), screen.indexOf('const commitRestore = useCallback'))
    assert.ok(replace.indexOf('setSyncVisible(false)') < replace.indexOf('onRestartRequired()'))
    assert.ok(replace.indexOf('setBackupVisible(false)') < replace.indexOf('onRestartRequired()'))
  })
})

describe('an interrupted restore', () => {
  async function phoneWithStaging (t) {
    const storagePath = await tempDir(t)
    const stagingPath = join(storagePath, RESTORE_STAGING_DIR)
    mkdirSync(join(storagePath, 'hyper-sdk'), { recursive: true })
    writeFileSync(join(storagePath, 'hyper-sdk', 'old'), 'old store')
    writeFileSync(join(storagePath, 'browser-bookmarks.json'), 'old bookmarks')
    writeFileSync(join(storagePath, 'keep.json'), 'untouched')
    mkdirSync(join(stagingPath, 'hyper-sdk'), { recursive: true })
    writeFileSync(join(stagingPath, 'hyper-sdk', 'new'), 'new store')
    writeFileSync(join(stagingPath, 'browser-bookmarks.json'), 'new bookmarks')
    writeFileSync(join(stagingPath, 'hyper-sdk-private'), 'new private')
    return { storagePath, stagingPath }
  }

  it('is put back the way it was on the next start', async (t) => {
    const { storagePath, stagingPath } = await phoneWithStaging(t)
    const previousPath = join(storagePath, RESTORE_PREVIOUS_DIR)

    // The app was killed after hyper-sdk and the new private store were
    // swapped in, before the bookmarks were.
    mkdirSync(previousPath)
    writeFileSync(join(previousPath, 'journal.json'), JSON.stringify({
      incoming: ['browser-bookmarks.json', 'hyper-sdk', 'hyper-sdk-private'],
      existing: ['browser-bookmarks.json', 'hyper-sdk']
    }))
    const { renameSync } = await import('node:fs')
    renameSync(join(storagePath, 'hyper-sdk'), join(previousPath, 'hyper-sdk'))
    renameSync(join(stagingPath, 'hyper-sdk'), join(storagePath, 'hyper-sdk'))
    renameSync(join(stagingPath, 'hyper-sdk-private'), join(storagePath, 'hyper-sdk-private'))

    assert.deepEqual(recoverInterruptedRestore(storagePath), { recovered: true })
    assert.equal(readFileSync(join(storagePath, 'hyper-sdk', 'old'), 'utf8'), 'old store')
    assert.equal(existsSync(join(storagePath, 'hyper-sdk', 'new')), false)
    assert.equal(existsSync(join(storagePath, 'hyper-sdk-private')), false)
    assert.equal(readFileSync(join(storagePath, 'browser-bookmarks.json'), 'utf8'), 'old bookmarks')
    assert.equal(readFileSync(join(storagePath, 'keep.json'), 'utf8'), 'untouched')
    assert.equal(existsSync(previousPath), false)
    assert.deepEqual(recoverInterruptedRestore(storagePath), { recovered: false })
  })

  it('that finished and only had its clean-up cut short is left finished', async (t) => {
    const { storagePath, stagingPath } = await phoneWithStaging(t)
    commitStagedRestore({ storagePath, stagingPath, names: ['browser-bookmarks.json', 'hyper-sdk'] })
    // What a crash during the final delete leaves behind.
    mkdirSync(join(storagePath, RESTORE_TRASH_DIR, 'hyper-sdk'), { recursive: true })

    recoverInterruptedRestore(storagePath)
    assert.equal(readFileSync(join(storagePath, 'hyper-sdk', 'new'), 'utf8'), 'new store')
    assert.equal(readFileSync(join(storagePath, 'browser-bookmarks.json'), 'utf8'), 'new bookmarks')
    assert.deepEqual(listOf(...(await import('node:fs')).readdirSync(storagePath)), listOf('browser-bookmarks.json', 'hyper-sdk', 'keep.json'))
  })

  it('is undone before anything opens a store', async () => {
    const main = await read('backend/main.mjs')
    assert.ok(main.indexOf('recoverLinkDeviceStorage()') > -1)
    assert.ok(main.indexOf('recoverLinkDeviceStorage()') < main.indexOf('createRpc()\n'))
  })
})

describe('streams that fail', () => {
  it('a failed write to the transfer drive is reported, not left hanging', async (t) => {
    const dir = await tempDir(t)
    const filePath = join(dir, 'transfer.peersky')
    writeFileSync(filePath, b4a.alloc(3 * 1024 * 1024, 1))

    let writes = 0
    const drive = {
      createWriteStream () {
        return new Writable({
          write (data, cb) {
            writes += 1
            cb(writes === 3 ? new Error('No space left on device') : null)
          }
        })
      }
    }

    let unhandled = null
    const onUnhandled = (reason) => { unhandled = reason }
    process.on('unhandledRejection', onUnhandled)
    t.after(() => process.off('unhandledRejection', onUnhandled))

    const outcome = await Promise.race([
      writeFileToDrive(drive, '/transfer.peersky', filePath).then(() => 'finished', (error) => error.message),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 2000))
    ])
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(outcome, 'No space left on device')
    assert.equal(unhandled, null)
  })

  it('bad deflate data fails cleanly, and a zip bomb is stopped as it expands', async (t) => {
    const dir = await tempDir(t)

    // Real deflate output, damaged inside its data only, and long enough to
    // pass the inflater's high water mark.
    const text = Array.from({ length: 60000 }, (_, index) => `line ${index} of a manifest ${index * 7919 % 1000}\n`).join('')
    const deflated = b4a.from(deflateRawSync(b4a.from(text)))
    for (let index = 64; index < deflated.length - 64; index += 97) deflated[index] ^= 0x5a
    writeFileSync(join(dir, 'broken.zip'), craftDeflatedEntry('manifest.json', deflated, b4a.byteLength(text)))

    // 200 bytes declared, 64 MB of zeros inside, in about 64 KB.
    writeFileSync(join(dir, 'bomb.zip'), craftDeflatedEntry('manifest.json', deflateRawSync(b4a.alloc(64 * 1024 * 1024)), 200))

    let unhandled = null
    const onUnhandled = (reason) => { unhandled = reason }
    process.on('unhandledRejection', onUnhandled)
    t.after(() => process.off('unhandledRejection', onUnhandled))

    for (const [name, expected] of [['broken.zip', /invalid|incorrect|size mismatch|unexpected end|error/i], ['bomb.zip', /size mismatch/]]) {
      const zip = openZipFile(join(dir, name))
      const entry = zip.find('manifest.json')
      let received = 0
      const before = process.memoryUsage().arrayBuffers
      const outcome = await Promise.race([
        zip.streamEntry(entry, (chunk) => { received += chunk.byteLength }).then(() => 'finished', (error) => error.message),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 5000))
      ])
      const grew = process.memoryUsage().arrayBuffers - before
      zip.close()
      assert.match(outcome, expected, name)
      // Stopped as soon as it passed the declared size, not after inflating
      // the whole chunk: the bomb expands to 64 MB.
      assert.ok(received <= entry.uncompressedSize, `${name} delivered ${received} bytes`)
      assert.ok(grew < 8 * 1024 * 1024, `${name} held ${grew} bytes while inflating`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(unhandled, null)
  })

  it('reads an entry over the high water mark through an inflater that works like Bare\'s', async (t) => {
    const dir = await tempDir(t)
    // Random bytes do not compress, so the deflated entry is well over the
    // inflater's 16 KB high water mark, like a desktop transfer that carries
    // a private drive. Waiting on this used to never end on a phone.
    const data = b4a.alloc(50 * 1024)
    sodium.randombytes_buf(data)
    writeFileSync(join(dir, 'large.zip'), craftDeflatedEntry('identity-payload.bin', deflateRawSync(data), data.byteLength))

    const zip = openZipFile(join(dir, 'large.zip'), { createInflater: bareLikeInflater })
    t.after(() => zip.close())
    const entry = zip.find('identity-payload.bin')
    assert.ok(entry.compressedSize > 16 * 1024)

    const chunks = []
    const outcome = await Promise.race([
      zip.streamEntry(entry, (chunk) => { chunks.push(chunk) }).then(() => 'finished', (error) => error.message),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 5000))
    ])
    assert.equal(outcome, 'finished')
    assert.ok(b4a.equals(b4a.concat(chunks), data))
  })
})

// Like bare-zlib's inflater: a bare-stream transform that finishes each write
// in the tick after it, where node's inflater works on another thread and
// answers later. It inflates once the input is all in, which is enough to
// show how writes and drains line up.
function bareLikeInflater ({ maxOutputLength }) {
  const input = []
  return new Transform({
    transform (chunk, encoding, callback) {
      input.push(chunk)
      callback(null)
    },
    flush (callback) {
      try {
        this.push(inflateRawSync(b4a.concat(input), { maxOutputLength }))
        callback(null)
      } catch (error) {
        callback(error)
      }
    }
  })
}

describe('what each kind of file may be opened as', () => {
  async function keys () {
    const pair = {
      signing: { publicKey: b4a.alloc(32), secretKey: b4a.alloc(64) },
      encryption: { publicKey: b4a.alloc(32), secretKey: b4a.alloc(32) }
    }
    sodium.crypto_sign_keypair(pair.signing.publicKey, pair.signing.secretKey)
    sodium.crypto_box_keypair(pair.encryption.publicKey, pair.encryption.secretKey)
    return pair
  }

  // Opening a transfer as a backup file would skip the six character code.
  it('a transfer is never restored as a backup file, nor a backup received as a transfer', async (t) => {
    const dir = await tempDir(t)
    const phone = join(dir, 'phone')
    mkdirSync(phone)
    writeFileSync(join(phone, 'browser-bookmarks.json'), '{"items":[]}')
    const sender = await keys()
    const receiver = await keys()
    const nonce = 'ab'.repeat(16)

    const transferPath = join(dir, 'transfer.peersky')
    await createPhoneTransfer({
      storagePath: phone,
      outPath: transferPath,
      target: { encryptionPublicKey: b4a.toString(receiver.encryption.publicKey, 'hex'), nonce },
      deviceKeys: sender
    })
    await assert.rejects(
      stagePhoneBackupFile({ filePath: transferPath, stagingPath: join(dir, 'staging'), deviceKeys: receiver, expectedNonce: nonce, kinds: [PHONE_BACKUP_KIND] }),
      (error) => error.code === 'WRONG_KIND' && /transfer made for one phone/.test(error.message)
    )

    const backupPath = join(dir, 'backup.peersky')
    await createPhoneBackup({ storagePath: phone, outPath: backupPath, passphrase: 'correct horse battery' })
    await assert.rejects(
      stagePhoneBackupFile({ filePath: backupPath, stagingPath: join(dir, 'staging'), passphrase: 'correct horse battery', kinds: [PHONE_TRANSFER_KIND] }),
      (error) => error.code === 'WRONG_KIND'
    )

    const source = await read('backend/backup/link-device.mjs')
    assert.match(source.slice(source.indexOf('export function restoreBackupFile')), /kinds: \[PHONE_BACKUP_KIND\]/)
    assert.match(source.slice(source.indexOf('export function receiveTransfer')), /kinds: \[PHONE_TRANSFER_KIND\]/)
  })

  it('a file that disappears while packing is left out, and the backup still finishes', async (t) => {
    const dir = await tempDir(t)
    const chunks = []
    const archive = createArchiveWriter(async (bytes) => { chunks.push(bytes) })
    writeFileSync(join(dir, 'here.json'), 'here')
    assert.equal(await archive.addFile('hyper-sdk/here.json', join(dir, 'here.json')), true)
    assert.equal(await archive.addFile('hyper-sdk/gone.json', join(dir, 'gone.json')), false)
    await archive.end()
    assert.ok(b4a.concat(chunks).includes(b4a.from('hyper-sdk/here.json')))
    assert.ok(!b4a.concat(chunks).includes(b4a.from('gone.json')))
  })
})

// One deflated entry whose header declares `declared` bytes.
function craftDeflatedEntry (name, deflated, declared) {
  const nameBytes = Buffer.from(name)
  const local = Buffer.alloc(30 + nameBytes.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(deflated.length, 18)
  local.writeUInt32LE(declared, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  nameBytes.copy(local, 30)

  const central = Buffer.alloc(46 + nameBytes.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(deflated.length, 20)
  central.writeUInt32LE(declared, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  nameBytes.copy(central, 46)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(local.length + deflated.length, 16)
  return Buffer.concat([local, deflated, central, end])
}
