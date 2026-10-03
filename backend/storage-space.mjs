// node:fs rather than bare-fs: backend/bare-imports.json maps it for the worklet.
import { mkdirSync, statfsSync } from 'node:fs'

/** Bytes free on the disk that holds this folder, or null when it cannot say. */
export function getFreeBytes (directory) {
  try {
    mkdirSync(directory, { recursive: true })
    const info = statfsSync(directory)
    const free = Number(info.bavail) * Number(info.bsize)
    return Number.isFinite(free) && free >= 0 ? free : null
  } catch {
    return null
  }
}

/** 4.2 GB, 310 MB, 12 KB: how big a file is, said the way people say it. */
export function formatStorageSize (bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
