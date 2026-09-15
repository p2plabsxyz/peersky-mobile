import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readZipEntries } from './zip.mjs'

const SKIP_ENTRIES = new Set(['manifest.json', 'manifest.mjson'])
const ALLOWED_FILES = new Set([
  'tabs.json',
  'browser-tabs.json',
  'lastOpened.json',
  'peersky-ports.json',
  'peersky-chat-rooms.json',
  'peersky-identity.json',
  'privateHyperdrives.json',
  'private-drive-key.json'
])
const DEVICE_LOCAL_PATHS = [
  'device-key.json',
  'hyper-sdk',
  'hyper-sdk-private',
  'peerchat-intro.json',
  'peerchat-ui-state.json',
  'peerchat-notifications.json'
]

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

    if (!ALLOWED_FILES.has(safeName) && !safeName.startsWith('hyper/') && !safeName.startsWith('hyper-private/')) {
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

export function commitIdentityRestore ({ storagePath, pendingPath, backupPath }) {
  if (!storagePath || !pendingPath || !backupPath || !existsSync(pendingPath)) {
    throw new Error('Identity restore paths are invalid')
  }

  rmSync(backupPath, { recursive: true, force: true })
  let movedCurrentStorage = false
  const preservedPaths = []

  try {
    if (existsSync(storagePath)) {
      renameSync(storagePath, backupPath)
      movedCurrentStorage = true
    }

    for (const relativePath of DEVICE_LOCAL_PATHS) {
      const source = joinPath(backupPath, relativePath)
      const destination = joinPath(pendingPath, relativePath)
      if (!existsSync(source) || existsSync(destination)) continue
      renameSync(source, destination)
      preservedPaths.push(relativePath)
    }

    renameSync(pendingPath, storagePath)
    return { preservedPaths }
  } catch (error) {
    if (!existsSync(storagePath)) {
      for (const relativePath of preservedPaths.reverse()) {
        const source = joinPath(pendingPath, relativePath)
        const destination = joinPath(backupPath, relativePath)
        if (existsSync(source) && !existsSync(destination)) renameSync(source, destination)
      }
      if (movedCurrentStorage && existsSync(backupPath)) renameSync(backupPath, storagePath)
    }
    throw error
  }
}

function normalizeZipEntryName (name) {
  const slashNormalized = String(name || '').replace(/\\/g, '/')
  const isDirectory = slashNormalized.endsWith('/')
  const normalized = slashNormalized.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized) return ''

  const parts = []
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('Backup contains illegal path traversal entries')
    parts.push(part)
  }

  const safeName = parts.join('/')
  return isDirectory ? `${safeName}/` : safeName
}

function joinPath (base, relativePath) {
  const normalizedBase = String(base || '.').replace(/[/\\]+$/, '')
  return `${normalizedBase}/${relativePath}`
}

function getDirName (filepath) {
  const separatorIndex = Math.max(filepath.lastIndexOf('/'), filepath.lastIndexOf('\\'))
  return separatorIndex === -1 ? '.' : filepath.slice(0, separatorIndex)
}
