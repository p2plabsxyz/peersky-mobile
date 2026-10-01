import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile as readFileAsync } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import crypto from 'node:crypto'
import b4a from 'b4a'
import { create as createSDK } from 'hyper-sdk'
import {
  publishTransferFile,
  purgeTransferDrive,
  TRANSFER_FILE_NAME,
  transferDriveName
} from '../../backend/backup/transfer-publisher.mjs'
import {
  convertDesktopBookmarks,
  convertDesktopTabs,
  isImportableUrl
} from '../../backend/backup/browser-import.mjs'

const SWARM_OFF = { bootstrap: [], port: 0 }

describe('sending a transfer to another phone', () => {
  it('puts the file on a drive the other phone can read, and takes it down after', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'peersky-transfer-publish-'))
    const sender = await createSDK({ storage: join(root, 'sender'), swarmOpts: SWARM_OFF, autoJoin: false })
    const receiver = await createSDK({ storage: join(root, 'receiver'), swarmOpts: SWARM_OFF, autoJoin: false })
    t.after(async () => {
      await Promise.allSettled([sender.close(), receiver.close()])
      await rm(root, { recursive: true, force: true })
    })

    // Bigger than one write chunk, so backpressure and the final commit are
    // both exercised.
    const payload = crypto.randomBytes(3 * 1024 * 1024 + 17)
    const filePath = join(root, 'outgoing.peersky')
    writeFileSync(filePath, payload)

    const nonce = 'ab'.repeat(16)
    const driveName = transferDriveName(nonce)
    assert.match(driveName, new RegExp(`^peersky-transfer-${nonce}-[0-9a-f]{8}$`))
    // A second send with the same code gets a drive of its own.
    assert.notEqual(transferDriveName(nonce), driveName)
    const progress = []
    const published = await publishTransferFile(sender, {
      driveName,
      filePath,
      onProgress: (done, total) => progress.push([done, total])
    })
    assert.match(published.url, /^hyper:\/\/[a-z0-9]{52}\/transfer\.peersky$/)
    assert.deepEqual(progress.at(-1), [payload.length, payload.length])

    // The two phones meet the way they do over the swarm: their stores
    // replicate over one connection.
    const one = sender.corestore.replicate(true)
    const two = receiver.corestore.replicate(false)
    one.pipe(two).pipe(one)
    t.after(() => {
      one.destroy()
      two.destroy()
    })

    const driveKey = new URL(published.url).hostname
    const remote = await receiver.getDrive(`hyper://${driveKey}/`, { autoJoin: false })
    await remote.core.update({ wait: true })
    const chunks = []
    for await (const chunk of remote.createReadStream(TRANSFER_FILE_NAME, { wait: true })) chunks.push(chunk)
    assert.ok(b4a.concat(chunks).equals(payload))

    // Done, or expired: the data is cleared on both phones.
    const senderBlobs = await (await sender.getDrive(driveName, { autoJoin: false })).getBlobs()
    const blocks = senderBlobs.core.length
    assert.ok(blocks > 0)
    assert.equal(await senderBlobs.core.has(0, blocks), true)

    await purgeTransferDrive(sender, driveName)
    await purgeTransferDrive(receiver, `hyper://${driveKey}/`)

    const reopened = await sender.getDrive(driveName, { autoJoin: false })
    const reopenedBlobs = await reopened.getBlobs()
    assert.equal(await reopenedBlobs.core.has(0), false)
    assert.equal(await reopenedBlobs.core.has(blocks - 1), false)
    const fetched = await receiver.getDrive(`hyper://${driveKey}/`, { autoJoin: false })
    assert.equal(await (await fetched.getBlobs()).core.has(0), false)
  })
})

describe('tabs and bookmarks from the desktop', () => {
  it('turns desktop windows into one list of tabs the phone can open', () => {
    const converted = JSON.parse(convertDesktopTabs(JSON.stringify({
      main: {
        tabs: [
          { id: 't1', url: 'https://example.com/', title: '  Example   page ' },
          { id: 't2', url: 'peersky://home', title: 'Home' },
          { id: 't3', url: 'hyper://akhilesh.art/', title: '' }
        ],
        activeTabId: 't1'
      },
      w2: { tabs: [{ id: 't4', url: 'https://example.com/', title: 'Duplicate' }, { url: 42 }] },
      broken: null
    }), { now: 7 }))

    assert.deepEqual(converted, {
      version: 1,
      source: 'desktop',
      receivedAt: 7,
      tabs: [
        { url: 'https://example.com/', title: 'Example page' },
        { url: 'hyper://akhilesh.art/', title: 'hyper://akhilesh.art/' }
      ]
    })
    // A cleared desktop session, or something that is not JSON, adds nothing.
    assert.equal(convertDesktopTabs('{}'), null)
    assert.equal(convertDesktopTabs('not json'), null)
    assert.equal(convertDesktopTabs(b4a.from(JSON.stringify({ main: { tabs: [] } }))), null)
  })

  it('takes desktop bookmarks the day the desktop sends them', () => {
    const converted = JSON.parse(convertDesktopBookmarks(JSON.stringify([
      { url: 'https://example.com/', title: 'Example', dateAdded: '2026-01-02T03:04:05.000Z' },
      { url: 'https://example.com/', title: 'Duplicate' },
      { url: 'file:///etc/passwd', title: 'No' },
      { url: 'https://no-date.example/', title: 'Undated' }
    ]), { now: 9 }))

    assert.deepEqual(converted.bookmarks, [
      { url: 'https://example.com/', title: 'Example', createdAt: Date.parse('2026-01-02T03:04:05.000Z') },
      { url: 'https://no-date.example/', title: 'Undated', createdAt: 9 }
    ])
    assert.equal(convertDesktopBookmarks('{}'), null)
  })

  it('only lets through addresses the phone can load', () => {
    assert.equal(isImportableUrl('https://example.com/'), true)
    assert.equal(isImportableUrl('hyper://akhilesh.art/'), true)
    assert.equal(isImportableUrl('peersky://settings'), false)
    assert.equal(isImportableUrl('javascript:alert(1)'), false)
    assert.equal(isImportableUrl(`https://example.com/${'a'.repeat(9000)}`), false)
  })

  it('the app picks both up on its next start', async () => {
    const app = await readFileAsync(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const restore = app.slice(app.indexOf('async function restoreBrowserSession'), app.indexOf('void restoreBrowserSession()'))
    assert.match(restore, /const incoming = await readIncomingTabs\(\)/)
    assert.match(restore, /appendIncomingBrowserTabs\(base, incoming\)/)
    // Saved first, then the file that brought them goes.
    assert.match(restore, /if \(incoming && writeBrowserSession\(next\)\) \{\s*removeIncomingTabs\(\)/)
    assert.match(app, /new File\(Paths\.document, 'incoming-tabs\.json'\)/)

    const bookmarks = await readFileAsync(new URL('../../app/bookmarks/useBrowserBookmarks.ts', import.meta.url), 'utf8')
    assert.match(bookmarks, /mergeIncomingBrowserBookmarks\(stored, incoming\)/)
    assert.match(bookmarks, /new File\(Paths\.document, 'incoming-bookmarks\.json'\)/)
    assert.ok(bookmarks.indexOf('file.write(serializeBrowserBookmarks(restored))') < bookmarks.indexOf('removeIncomingBookmarks()\n        }'))
  })
})

// An operation started inside a maintenance window waits for that window to
// end, and the window waits for it: the runtime is wedged until the app is
// killed. confirmRestore did this once, stopping an outgoing transfer from
// inside its window.
describe('Link Device and the runtime coordinator', () => {
  it('never waits on a runtime operation from inside a maintenance window', async () => {
    const source = await readFileAsync(new URL('../../backend/backup/link-device.mjs', import.meta.url), 'utf8')

    // Every window goes through withStoresClosed, and what runs inside is
    // the task handed to it: take the text of each call's argument.
    assert.equal((source.match(/withHyperRuntimeMaintenance\(/g) || []).length, 1)
    const tasks = []
    let index = source.indexOf('withStoresClosed(')
    while (index !== -1) {
      if (!source.startsWith('withStoresClosed (task)', index - 9)) {
        tasks.push(callArgument(source, index + 'withStoresClosed'.length))
      }
      index = source.indexOf('withStoresClosed(', index + 1)
    }

    assert.equal(tasks.length, 4)
    for (const body of tasks) {
      for (const call of ['withHyperRuntimeOperation', 'stopOutgoingTransfer(', 'clearTransferDrive(', 'purgeTransferDrive(', 'fetchHyperToFile(', 'getPeerChatService(']) {
        assert.equal(body.includes(call), false, `${call} inside a maintenance window`)
      }
    }

    const confirm = source.slice(source.indexOf('export function confirmRestore'), source.indexOf('export function sendTransfer'))
    assert.ok(confirm.indexOf('await stopOutgoingTransfer()') < confirm.indexOf('withStoresClosed('))
  })

  it('the coordinator really does wedge on that, which is why it matters', async () => {
    const { createRuntimeCoordinator } = await import('../../backend/hyper/runtime-coordinator.mjs')
    const { runMaintenance, runOperation } = createRuntimeCoordinator()
    const nested = runMaintenance(async () => runOperation(async () => 'done'))
    const outcome = await Promise.race([
      nested,
      new Promise((resolve) => setTimeout(() => resolve('wedged'), 200))
    ])
    assert.equal(outcome, 'wedged')
  })
})

// The text between a call's opening parenthesis and its match.
function callArgument (source, openAt) {
  let depth = 0
  for (let index = openAt; index < source.length; index += 1) {
    const character = source[index]
    if (character === '(') depth += 1
    if (character === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openAt + 1, index)
    }
  }
  throw new Error('Unbalanced call')
}
