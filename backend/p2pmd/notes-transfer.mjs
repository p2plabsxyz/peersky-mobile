// P2PMD notes sent to, or taken from, another of this person's devices. Keep
// in step with notes-transfer.js in desktop P2PMD (same JSON, version 1).
//
// Only a note's key, its listed name and, for a private note this phone
// hosts, its text travel. A drive address, port or seed belongs to one
// device: a copied desktop profile that kept one wrote to a drive the new
// machine could not write to (p2pmd#18). A private note's key (hs://s000...)
// is what the host's keys are made from, so either device can host it, or
// join it when the other has it open. Any other note goes as a note to join.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import b4a from 'b4a'
import { P2PMD_INCOMING_FILE } from './constants.mjs'
import { loadP2pmdRoomSnapshot, saveP2pmdRoomSnapshot } from './snapshots.mjs'

export { P2PMD_INCOMING_FILE } from './constants.mjs'

export const P2PMD_NOTES_TRANSFER_VERSION = 1
// The recent list shows five, here and on the desktop.
export const MAX_TRANSFER_NOTES = 5
// A desktop takes at most 4 MiB in one file, so the text stays well under it.
export const MAX_TRANSFER_TEXT_BYTES = 3 * 1024 * 1024

const HISTORY_FILE = 'p2pmd-room-history.json'
const PROFILE_FILE = 'p2pmd-profile.json'
const MAX_FILE_BYTES = 8 * 1024 * 1024
const KEY_VALUE = /^[a-z0-9]{32,256}$/i
const MAX_LABEL_LENGTH = 64
const MAX_NAME_LENGTH = 32

/** Whether any device holding this key can host the note: a private one. */
export function isPrivateNoteKey (key) {
  return /^hs:\/\/s[a-z0-9]{3}/i.test(key)
}

/** A note's key as `hs://...`, or '' when it is not one. */
export function canonicalNoteKey (value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  const base = trimmed.toLowerCase().startsWith('hs://') ? trimmed.slice(5) : trimmed
  return KEY_VALUE.test(base) ? `hs://${base}` : ''
}

/**
 * What this phone sends a desktop: its P2PMD name and its recent notes, the
 * hosted ones with their text when it fits. Null when there is nothing.
 * `shared` lists the notes that went with their text, for the app to mark:
 * this phone too looks for them on the other device first from now on.
 */
export function collectP2pmdNotes ({ documentsPath, hyperStoragePath } = {}) {
  const history = readJson(join(documentsPath, HISTORY_FILE))
  const items = Array.isArray(history?.items) ? history.items : []
  const seen = new Set()
  const notes = []
  const shared = []
  let budget = MAX_TRANSFER_TEXT_BYTES

  const recent = items
    .map((item) => ({ item, key: canonicalNoteKey(item?.key), openedAt: timestamp(item?.lastOpenedAt) }))
    .filter(({ key }) => key)
    .sort((left, right) => right.openedAt - left.openedAt)
  for (const { item, key, openedAt } of recent) {
    if (seen.has(key)) continue
    seen.add(key)
    const role = item.role === 'host' && isPrivateNoteKey(key) ? 'host' : 'client'
    let content
    let updatedAt = openedAt
    if (role === 'host') {
      const snapshot = loadP2pmdRoomSnapshot(key, hyperStoragePath)
      if (snapshot && byteLength(snapshot.content) <= budget) {
        content = snapshot.content
        updatedAt = timestamp(snapshot.updatedAt) || openedAt
        budget -= byteLength(content)
        shared.push(key)
      }
    }
    notes.push({
      key,
      role,
      label: normalizeLabel(item.label),
      ...(content !== undefined && { content }),
      updatedAt,
      openedAt
    })
    if (notes.length === MAX_TRANSFER_NOTES) break
  }

  const name = normalizeName(readJson(join(documentsPath, PROFILE_FILE))?.name)
  if (notes.length === 0 && !name) return null
  return { transfer: { version: P2PMD_NOTES_TRANSFER_VERSION, name, notes }, shared }
}

/**
 * Takes the notes a desktop left for this phone. The text of a hosted note
 * becomes this phone's copy unless it already has one: nothing here is
 * replaced. Returns what the app adds to its recent list, without touching
 * that list itself, which the app owns. The file stays until the app has
 * saved the list, so a crash in between loses nothing.
 */
export function takeP2pmdNotes ({ documentsPath, hyperStoragePath } = {}) {
  const incoming = normalizeP2pmdNotesTransfer(readJson(join(documentsPath, P2PMD_INCOMING_FILE)))
  if (!incoming) return { ok: false, notes: [], name: '' }

  const notes = []
  for (const note of incoming.notes) {
    let hasCopy = false
    if (note.role === 'host') {
      hasCopy = Boolean(loadP2pmdRoomSnapshot(note.key, hyperStoragePath))
      if (!hasCopy && note.content !== undefined) {
        hasCopy = saveP2pmdRoomSnapshot(note.key, {
          content: note.content,
          lineAttributions: {},
          updatedAt: note.updatedAt || note.openedAt
        }, hyperStoragePath)
      }
    }
    // Only a note with a copy here can ever be hosted from it. Without one,
    // hosting would put an empty note up in place of the real one, so it is
    // a note to join.
    const role = hasCopy ? 'host' : 'client'
    notes.push({ key: note.key, role, label: note.label, lastOpenedAt: note.openedAt, shared: role === 'host' })
  }
  return { ok: true, notes, name: incoming.name }
}

/**
 * The transfer as this phone takes it, or null. Every field is checked and
 * anything else is dropped, so nothing else in a transfer can reach storage.
 */
export function normalizeP2pmdNotesTransfer (value) {
  if (!value || typeof value !== 'object' || value.version !== P2PMD_NOTES_TRANSFER_VERSION || !Array.isArray(value.notes)) {
    return null
  }

  let budget = MAX_TRANSFER_TEXT_BYTES
  const seen = new Set()
  const notes = []
  for (const item of value.notes.slice(0, MAX_TRANSFER_NOTES)) {
    const key = canonicalNoteKey(item?.key)
    if (!key || seen.has(key)) continue
    seen.add(key)
    // Only a private note can be hosted anywhere else, whatever a sender says.
    const role = item.role === 'host' && isPrivateNoteKey(key) ? 'host' : 'client'
    let content
    if (role === 'host' && typeof item.content === 'string' && byteLength(item.content) <= budget) {
      content = item.content
      budget -= byteLength(item.content)
    }
    notes.push({
      key,
      role,
      label: normalizeLabel(item.label),
      ...(content !== undefined && { content }),
      updatedAt: timestamp(item.updatedAt),
      openedAt: timestamp(item.openedAt)
    })
  }

  return { version: P2PMD_NOTES_TRANSFER_VERSION, name: normalizeName(value.name), notes }
}

function normalizeLabel (value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LENGTH) : ''
}

function normalizeName (value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) : ''
}

function timestamp (value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function byteLength (text) {
  return b4a.byteLength(text)
}

function readJson (path) {
  try {
    if (!existsSync(path)) return null
    const bytes = readFileSync(path)
    if (bytes.byteLength > MAX_FILE_BYTES) return null
    return JSON.parse(b4a.toString(bytes, 'utf8'))
  } catch {
    return null
  }
}
