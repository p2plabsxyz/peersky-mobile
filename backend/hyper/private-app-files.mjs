import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import { getDefaultIdentityStoragePath } from '../backup/device-keys.mjs'
import { NOTE_PORTS_FILE } from '../p2pmd/note-ports.mjs'
import { PUBLIC_NOTES_FILE } from '../p2pmd/public-notes.mjs'
import { sealP2pmdSnapshotsAtRest } from '../p2pmd/snapshots.mjs'
import { getHyperStoragePath } from './runtime.mjs'
import {
  canSealChats,
  CHAT_SEAL,
  readSealedJson,
  sealFilesAtRest,
  waitForChatSealKey,
  writeSealedJson
} from './sealed-file.mjs'

// The app's own files that hold chats or notes: what was typed in each chat
// and not sent, with the chat each tab is on, and the recent notes with their
// keys. The app reads and writes them through here, where the chat key is
// (sealed-file.mjs), and a file from before it is locked the first time it is
// read.
export const PRIVATE_APP_FILES = Object.freeze(['peerchat-ui-state.json', 'p2pmd-room-history.json'])
const MAX_PRIVATE_APP_FILE_BYTES = 2 * 1024 * 1024

function filePathFor (name, documentsPath) {
  return PRIVATE_APP_FILES.includes(name) ? join(documentsPath, name) : ''
}

/** { ok, text }, text null when there is no file. */
export async function readPrivateAppFile ({ name } = {}, { documentsPath = getDefaultIdentityStoragePath() } = {}) {
  const filePath = filePathFor(name, documentsPath)
  if (!filePath) return { ok: false, error: 'Not one of the app\'s private files.' }
  await waitForChatSealKey()
  if (!existsSync(filePath)) return { ok: true, text: null }
  if (statSync(filePath).size > MAX_PRIVATE_APP_FILE_BYTES) return { ok: false, error: `${name} is too large.` }
  const read = readSealedJson(filePath)
  if (!read) return { ok: true, text: null }
  if (!read.sealed) {
    try {
      writeSealedJson(filePath, read.value, { seal: CHAT_SEAL })
    } catch (error) {
      console.warn(`[backend] Could not lock ${name}:`, error?.message || error)
    }
  }
  return { ok: true, text: JSON.stringify(read.value) }
}

export async function writePrivateAppFile ({ name, text } = {}, { documentsPath = getDefaultIdentityStoragePath() } = {}) {
  const filePath = filePathFor(name, documentsPath)
  if (!filePath) return { ok: false, error: 'Not one of the app\'s private files.' }
  if (typeof text !== 'string' || b4a.byteLength(text) > MAX_PRIVATE_APP_FILE_BYTES) {
    return { ok: false, error: `${name} is too large.` }
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, error: `${name} is not JSON.` }
  }
  await waitForChatSealKey()
  writeSealedJson(filePath, value, { seal: CHAT_SEAL })
  return { ok: true }
}

/**
 * Locks what a build before the chat key left plain, once the key is here:
 * PeerChat's file, which PeerChat locks too as it starts, P2PMD's copies of
 * notes and its lists, and the app's own files. A restore leaves them plain
 * as well. The files a restore leaves for PeerChat and P2PMD to take are not
 * touched: they go as soon as they are read.
 */
export function sealChatFilesAtRest ({
  documentsPath = getDefaultIdentityStoragePath(),
  hyperStoragePath = getHyperStoragePath()
} = {}) {
  if (!canSealChats() || !hyperStoragePath) return { sealed: [], moved: 0 }
  const sealed = sealFilesAtRest([
    join(hyperStoragePath, 'peerchat-mobile.json'),
    join(hyperStoragePath, NOTE_PORTS_FILE),
    join(hyperStoragePath, PUBLIC_NOTES_FILE),
    ...PRIVATE_APP_FILES.map((name) => join(documentsPath, name))
  ], { seal: CHAT_SEAL })
  return { sealed, moved: sealP2pmdSnapshotsAtRest(hyperStoragePath) }
}
