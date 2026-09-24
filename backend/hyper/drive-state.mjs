import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import { hash } from 'hypercore-crypto'

export const DRIVE_HEAD_STATE_FILE = 'drive-head-state.json'
const HEX_DRIVE_ID = /^[0-9a-f]{64}$/
const HEX_HASH = /^[0-9a-f]{64}$/
const EMPTY_HEAD_HASH = hash(b4a.alloc(0)).toString('hex')

export async function captureDriveHead (core) {
  const length = core.length
  let headHash = EMPTY_HEAD_HASH

  if (length > 0) {
    const block = await readBlockAt(core, length - 1)
    if (block) headHash = hash(block).toString('hex')
  }

  return { length, headHash }
}

export function readDriveHeadState (storagePath) {
  if (!storagePath) return {}
  const root = String(storagePath).replace(/[/\\]+$/, '')

  try {
    const filePath = join(root, DRIVE_HEAD_STATE_FILE)
    if (!existsSync(filePath)) return {}
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const state = {}
    for (const [driveId, entry] of Object.entries(parsed)) {
      if (!HEX_DRIVE_ID.test(driveId)) continue
      if (!entry || typeof entry !== 'object') continue
      if (!Number.isSafeInteger(entry.length) || entry.length < 0) continue
      if (typeof entry.headHash !== 'string' || !HEX_HASH.test(entry.headHash)) continue
      state[driveId] = { length: entry.length, headHash: entry.headHash }
    }
    return state
  } catch {
    return {}
  }
}

export function persistDriveHeadState (storagePath, driveId, head) {
  if (!storagePath || !HEX_DRIVE_ID.test(driveId)) return
  const root = String(storagePath).replace(/[/\\]+$/, '')
  const state = readDriveHeadState(root)
  state[driveId] = { length: head.length, headHash: head.headHash }

  try {
    writeFileSync(join(root, DRIVE_HEAD_STATE_FILE), JSON.stringify(state, null, 2))
  } catch {}
}

export async function checkPrivateDriveDivergence ({ storagePath, driveId, core }) {
  const current = await captureDriveHead(core)
  const persisted = readDriveHeadState(storagePath)[driveId]

  const diverged = await divergesFromPersisted(persisted, current, core)

  if (!diverged) persistDriveHeadState(storagePath, driveId, current)

  return { diverged, current, persisted }
}

async function divergesFromPersisted (persisted, current, core) {
  if (!persisted) return false
  if (current.length < persisted.length) return true

  if (persisted.length === 0) return false

  if (current.length === persisted.length) {
    return current.headHash === EMPTY_HEAD_HASH
      ? false
      : current.headHash !== persisted.headHash
  }

  const block = await readBlockAt(core, persisted.length - 1)
  if (!block) return false
  return hash(block).toString('hex') !== persisted.headHash
}

async function readBlockAt (core, index) {
  try {
    const block = await core.get(index, { wait: false })
    return block && block.length ? block : null
  } catch {
    return null
  }
}
