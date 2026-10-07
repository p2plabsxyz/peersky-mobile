import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import z32 from 'z32'
import {
  BLOCKED_DRIVES,
  blockedDriveHash,
  blockReportedDrives,
  isBlockedDrive
} from '../../backend/hyper/blocked-drives.mjs'

// fetch.mjs and runtime.mjs load Bare-only modules, so they are read here
// rather than run, as the other hyper tests do.
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const key = randomBytes(32)
const hex = key.toString('hex')
const blocked = new Set([blockedDriveHash(hex)])

describe('drives reported for copyright infringement', () => {
  it('ships with nothing on the list', () => {
    assert.equal(BLOCKED_DRIVES.size, 0)
    assert.equal(isBlockedDrive(`hyper://${hex}/`), false)
  })

  it('knows a blocked drive by any way it is written', () => {
    assert.equal(isBlockedDrive(`hyper://${z32.encode(key)}/music/song.mp3`, blocked), true)
    assert.equal(isBlockedDrive(`hyper://${hex}/`, blocked), true)
    assert.equal(isBlockedDrive(hex, blocked), true)
    assert.equal(isBlockedDrive(z32.encode(key), blocked), true)
    assert.equal(isBlockedDrive(key, blocked), true)
    assert.equal(isBlockedDrive(`hyper://${randomBytes(32).toString('hex')}/`, blocked), false)
    assert.equal(isBlockedDrive('p2pmd', blocked), false)
  })

  it('keeps the addresses themselves off the list', () => {
    assert.notEqual(blockedDriveHash(hex), hex)
    assert.match(blockedDriveHash(hex), /^[0-9a-f]{64}$/)
  })

  it('never opens a blocked drive, so it is never shown or passed on', async () => {
    const opened = []
    const sdk = blockReportedDrives({ getDrive: async (address) => { opened.push(address); return { address } } }, blocked)
    await assert.rejects(sdk.getDrive(`hyper://${hex}/`), (error) => error.code === 'BLOCKED_DRIVE' && error.status === 451)
    const other = `hyper://${randomBytes(32).toString('hex')}/`
    assert.deepEqual(await sdk.getDrive(other), { address: other })
    assert.deepEqual(opened, [other])
  })

  it('answers a page or app asking for one with 451, before opening anything', async () => {
    const fetch = await read('backend/hyper/fetch.mjs')
    assert.match(fetch, /if \(target\.error\) return \{ ok: false, error: target\.error \}\n {2}if \(isBlockedDrive\(target\.driveAddress\)\) return \{ ok: false, status: 451, error: BLOCKED_DRIVE_MESSAGE \}/)
  })

  it('guards the store every public drive opens from', async () => {
    const runtime = await read('backend/hyper/runtime.mjs')
    assert.match(runtime, /createSDK\(\{ storage: storagePath \}\)\n\s+\.then\(shareDriveOpens\)\n\s+\.then\(blockReportedDrives\)/)
  })
})
