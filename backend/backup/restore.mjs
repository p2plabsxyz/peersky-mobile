import { mkdirSync, writeFileSync } from 'node:fs'
import { readZipEntries } from './zip.mjs'

const SKIP_ENTRIES = new Set(['manifest.json', 'manifest.mjson'])
const ALLOWED_FILES = new Set([
  'tabs.json',
  'browser-tabs.json',
  'lastOpened.json',
  'peersky-ports.json',
  'peersky-chat-rooms.json'
])

export async function restoreIdentityFromBackup (innerZipBytes, storagePath) {
  const entries = readZipEntries(innerZipBytes)
  let restoredFiles = 0

  mkdirSync(storagePath, { recursive: true })

  for (const entry of entries) {
    let safeName = normalizeZipEntryName(entry.name)
    if (!safeName || SKIP_ENTRIES.has(safeName)) continue

    if (safeName === 'device-key.json') {
      throw new Error('Refusing to restore device-key.json from backup')
    }

    if (!ALLOWED_FILES.has(safeName) && !safeName.startsWith('hyper/')) {
      throw new Error(`Refusing to restore unknown file: ${safeName}`)
    }

    if (safeName === 'tabs.json') {
      safeName = 'browser-tabs.json'
    }

    const targetPath = joinPath(storagePath, safeName)

    if (entry.isDirectory) {
      mkdirSync(targetPath, { recursive: true })
      continue
    }

    mkdirSync(getDirName(targetPath), { recursive: true })
    writeFileSync(targetPath, entry.bytes)
    restoredFiles += 1
  }

  if (restoredFiles === 0) {
    throw new Error('Decrypted backup did not contain any restorable files')
  }

  return { restoredFiles }
}

function normalizeZipEntryName (name) {
  const normalized = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.endsWith('/')) return normalized.replace(/\/+$/, '')

  const parts = []
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('Backup contains illegal path traversal entries')
    parts.push(part)
  }

  return parts.join('/')
}

function joinPath (base, relativePath) {
  const normalizedBase = String(base || '.').replace(/[/\\]+$/, '')
  return `${normalizedBase}/${relativePath}`
}

function getDirName (filepath) {
  const separatorIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'))
  return separatorIndex === -1 ? '.' : filepath.slice(0, separatorIndex)
}
