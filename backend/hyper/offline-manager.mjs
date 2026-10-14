import {
  getHyperOfflineItemId,
  normalizeWantedHyperOfflineItem
} from './offline-core.mjs'
import {
  addWantedHyperOfflineItem,
  listWantedHyperOfflineItems,
  removeWantedHyperOfflineItem
} from './offline-manifest.mjs'
import { withHyperRuntimeForAddress } from './runtime.mjs'
import { parseHyperUrl } from './url.mjs'

const MAX_OFFLINE_SIZE_ENTRIES = 5000
const MAX_OFFLINE_PROGRESS_BLOCKS = 100000
const OFFLINE_PROGRESS_SCAN_BATCH = 256

export function createHyperOfflineManager ({
  runWithRuntime,
  addWantedItem,
  listWantedItems,
  removeWantedItem
}) {
  const activeDownloads = new Map()
  const pausedItems = new Set()
  const failedItems = new Map()
  const removingItems = new Set()
  let automaticNetworkAllowed = true

  async function keep ({ url, wait = true, allowNetwork = true } = {}) {
    const target = parseHyperUrl(url)
    if (target.error || target.driveAddress === 'default') {
      return { ok: false, error: target.error || 'A Hyperdrive address is required.' }
    }

    let item
    try {
      item = await runWithRuntime(target.driveAddress, async (runtime) => {
        const drive = await runtime.getDrive(target.driveAddress)
        return normalizeWantedHyperOfflineItem({
          driveKey: drive.id,
          path: target.pathname
        })
      })
    } catch (error) {
      return failure(error)
    }

    if (!item) return { ok: false, error: 'Unable to resolve the Hyperdrive key.' }
    const id = getHyperOfflineItemId(item)
    if (removingItems.has(id)) return { ok: false, error: 'Offline folder is being removed.' }
    try {
      if (!await addWantedItem(item)) {
        return { ok: false, error: 'Unable to save the offline download request.' }
      }
    } catch (error) {
      return failure(error)
    }

    if (!allowNetwork) {
      return success(item, await hasItem(item) ? 'available' : 'waiting-for-wifi')
    }

    const download = start(item)
    return wait === false ? success(item, 'downloading') : download
  }

  async function pause (candidate) {
    let item
    try {
      item = await findWantedItem(candidate)
    } catch (error) {
      return failure(error)
    }
    if (!item) return { ok: false, error: 'Offline folder not found.' }

    const id = getHyperOfflineItemId(item)
    pausedItems.add(id)
    failedItems.delete(id)
    const active = activeDownloads.get(id)
    if (active) {
      active.cancelled = true
      active.download?.destroy()
    }

    return success(item, 'paused')
  }

  async function resume (candidate) {
    let item
    try {
      item = await findWantedItem(candidate)
    } catch (error) {
      return failure(error)
    }
    if (!item) return { ok: false, error: 'Offline folder not found.' }
    if (candidate?.allowNetwork === false) {
      return success(item, await hasItem(item) ? 'available' : 'waiting-for-wifi')
    }
    const download = start(item)
    return candidate?.wait === false ? success(item, 'downloading') : download
  }

  async function remove (candidate) {
    const normalized = normalizeWantedHyperOfflineItem(candidate)
    if (!normalized) return { ok: false, error: 'Offline folder not found.' }

    const id = getHyperOfflineItemId(normalized)
    if (removingItems.has(id)) return { ok: false, error: 'Offline folder is already being removed.' }
    removingItems.add(id)

    try {
      const item = await findWantedItem(normalized)
      if (!item) return { ok: false, error: 'Offline folder not found.' }

      const active = activeDownloads.get(id)
      if (active) {
        active.cancelled = true
        active.download?.destroy()
        await active.promise
      }

      if (!await removeWantedItem(item)) {
        return { ok: false, error: 'Unable to remove the offline folder.' }
      }

      pausedItems.delete(id)
      failedItems.delete(id)

      try {
        const retainedItems = await listWantedItems()
        const cleared = await clearCachedFolder(runWithRuntime, item, retainedItems)
        return {
          ok: true,
          item: { ...item, status: 'removed' },
          cacheCleared: true,
          ...cleared
        }
      } catch (error) {
        return {
          ok: true,
          item: { ...item, status: 'removed' },
          cacheCleared: false,
          warning: `Offline folder was removed, but cached data could not be cleared. ${normalizeError(error)}`
        }
      }
    } catch (error) {
      return failure(error)
    } finally {
      removingItems.delete(id)
    }
  }

  async function resumeAll ({ allowNetwork = true } = {}) {
    automaticNetworkAllowed = allowNetwork
    let items
    try {
      items = await listWantedItems()
    } catch (error) {
      return { ...failure(error), items: [] }
    }
    pruneState(items)
    if (!allowNetwork) await stopActiveDownloads()
    const results = []

    for (const item of items) {
      const id = getHyperOfflineItemId(item)
      if (pausedItems.has(id)) {
        results.push(success(item, 'paused'))
        continue
      }

      const available = await hasItem(item)
      if (available) {
        failedItems.delete(id)
        results.push(success(item, 'available'))
      } else if (!automaticNetworkAllowed) {
        results.push(success(item, 'waiting-for-wifi'))
      } else {
        results.push(await start(item))
      }
    }

    return { ok: results.every((result) => result.ok), items: results.map(resultItem) }
  }

  async function list ({ allowNetwork = true, driveKey, path } = {}) {
    let items
    try {
      items = await listWantedItems()
    } catch (error) {
      return { ...failure(error), items: [] }
    }
    pruneState(items)
    if (driveKey !== undefined || path !== undefined) {
      const candidate = normalizeWantedHyperOfflineItem({ driveKey, path })
      if (!candidate) return { ok: false, error: 'Invalid offline folder.', items: [] }
      const id = getHyperOfflineItemId(candidate)
      items = items.filter((item) => getHyperOfflineItemId(item) === id)
    }
    const results = []

    for (const item of items) {
      const id = getHyperOfflineItemId(item)
      const active = activeDownloads.get(id)
      if (active) {
        results.push(success(item, 'downloading', active.progress || {}))
      } else if (pausedItems.has(id)) {
        results.push(success(item, 'paused'))
      } else if (await hasItem(item)) {
        failedItems.delete(id)
        results.push(success(item, 'available', await getAvailableSize(item)))
      } else if (failedItems.has(id)) {
        results.push({
          ok: false,
          error: failedItems.get(id),
          item: { ...item, status: 'error' }
        })
      } else {
        results.push(success(item, allowNetwork ? 'paused' : 'waiting-for-wifi'))
      }
    }

    return { ok: true, items: results.map(resultItem) }
  }

  async function close () {
    await stopActiveDownloads()
    activeDownloads.clear()
  }

  async function stopActiveDownloads () {
    const downloads = [...activeDownloads.values()]
    for (const active of downloads) {
      active.cancelled = true
      active.download?.destroy()
    }
    await Promise.allSettled(downloads.map((active) => active.promise))
  }

  function start (item) {
    const id = getHyperOfflineItemId(item)
    if (removingItems.has(id)) {
      return Promise.resolve({ ok: false, error: 'Offline folder is being removed.' })
    }
    const existing = activeDownloads.get(id)
    if (existing) return existing.promise

    pausedItems.delete(id)
    failedItems.delete(id)
    const active = { cancelled: false, download: null, progress: null, promise: null }
    active.promise = runWithRuntime(`hyper://${item.driveKey}/`, async (runtime) => {
      const drive = await runtime.getDrive(`hyper://${item.driveKey}/`)
      if (await drive.has(item.path)) return success(item, 'available')
      if (active.cancelled) return success(item, 'paused')

      const progress = await createOfflineProgressTracker(drive, item.path, active)
      try {
        if (active.cancelled) return success(item, 'paused')
        active.download = drive.download(item.path)
        await active.download.done()
        if (active.cancelled) return success(item, 'paused')
        if (!await drive.has(item.path)) {
          throw new Error('The offline download did not complete.')
        }
        progress?.complete()
        return success(item, 'available')
      } finally {
        progress?.close()
      }
    }).catch((error) => {
      const message = normalizeError(error)
      if (!active.cancelled) failedItems.set(id, message)
      return active.cancelled
        ? success(item, 'paused')
        : { ok: false, error: message, item: { ...item, status: 'error' } }
    }).finally(() => {
      if (activeDownloads.get(id) === active) activeDownloads.delete(id)
    })

    activeDownloads.set(id, active)
    return active.promise
  }

  async function hasItem (item) {
    try {
      return await runWithRuntime(`hyper://${item.driveKey}/`, async (runtime) => {
        const drive = await runtime.getDrive(`hyper://${item.driveKey}/`, { autoJoin: false })
        return drive.has(item.path)
      })
    } catch {
      return false
    }
  }

  async function getAvailableSize (item) {
    try {
      return await runWithRuntime(`hyper://${item.driveKey}/`, async (runtime) => {
        const drive = await runtime.getDrive(`hyper://${item.driveKey}/`, { autoJoin: false })
        let byteLength = 0
        let entries = 0

        for await (const entry of drive.list(item.path, { wait: false })) {
          entries += 1
          if (entries > MAX_OFFLINE_SIZE_ENTRIES) {
            return { byteLength, sizeTruncated: true }
          }
          if (!entry?.value?.blob) continue
          const entryBytes = Number(entry.value.blob.byteLength)
          if (Number.isSafeInteger(entryBytes) && entryBytes > 0) {
            byteLength = byteLength > Number.MAX_SAFE_INTEGER - entryBytes
              ? Number.MAX_SAFE_INTEGER
              : byteLength + entryBytes
          }
        }

        return { byteLength, sizeTruncated: false }
      })
    } catch {
      return { sizeUnavailable: true }
    }
  }

  async function findWantedItem (candidate) {
    const normalized = normalizeWantedHyperOfflineItem(candidate)
    if (!normalized) return null
    const id = getHyperOfflineItemId(normalized)
    return (await listWantedItems()).find((item) => getHyperOfflineItemId(item) === id) || null
  }

  function pruneState (items) {
    const retainedIds = new Set(items.map(getHyperOfflineItemId))
    for (const id of pausedItems) {
      if (!retainedIds.has(id)) pausedItems.delete(id)
    }
    for (const id of failedItems.keys()) {
      if (!retainedIds.has(id)) failedItems.delete(id)
    }
  }

  // Whether downloads may use the network now: false while Download only on
  // Wi-Fi is on and the phone is on cellular, as the app last said.
  const networkAllowed = () => automaticNetworkAllowed

  return { close, keep, list, networkAllowed, pause, remove, resume, resumeAll }
}

async function createOfflineProgressTracker (drive, path, active) {
  if (typeof drive.getBlobs !== 'function') return null

  try {
    const blobs = await drive.getBlobs()
    const blocks = new Map()
    let entries = 0

    for await (const entry of drive.list(path)) {
      entries += 1
      if (entries > MAX_OFFLINE_SIZE_ENTRIES) return null

      const blob = entry?.value?.blob
      if (!blob) continue
      const remainingCapacity = MAX_OFFLINE_PROGRESS_BLOCKS - blocks.size

      if (blob.blockMap) {
        const blockMap = await blobs.getBlockMap(blob)
        if (!blockMap || blockMap.blocks.length > remainingCapacity) return null
        for (const block of blockMap.blocks) {
          addProgressBlock(blocks, block.index, block.byteLength)
        }
        continue
      }

      const blockOffset = Number(blob.blockOffset)
      const blockLength = Number(blob.blockLength)
      const byteLength = Number(blob.byteLength)
      if (
        !Number.isSafeInteger(blockOffset) || blockOffset < 0 ||
        !Number.isSafeInteger(blockLength) || blockLength < 0 ||
        !Number.isSafeInteger(byteLength) || byteLength < 0 ||
        blockLength > remainingCapacity
      ) return null

      let remainingBytes = byteLength
      for (let offset = 0; offset < blockLength; offset += 1) {
        const blockBytes = Math.min(blobs.blockSize || 65536, remainingBytes)
        addProgressBlock(blocks, blockOffset + offset, blockBytes)
        remainingBytes -= blockBytes
      }
    }

    if (blocks.size === 0) return null

    const totalBytes = [...blocks.values()].reduce(safeByteSum, 0)
    if (totalBytes < 1) return null

    const completedBlocks = new Set()
    let downloadedBytes = 0

    const markCompleted = (index) => {
      if (!blocks.has(index) || completedBlocks.has(index)) return
      completedBlocks.add(index)
      downloadedBytes = safeByteSum(downloadedBytes, blocks.get(index))
      active.progress = {
        downloadedBytes,
        totalBytes,
        percentage: Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100))
      }
    }
    const blockIndexes = [...blocks.keys()]
    for (let offset = 0; offset < blockIndexes.length; offset += OFFLINE_PROGRESS_SCAN_BATCH) {
      if (active.cancelled) return null
      const batch = blockIndexes.slice(offset, offset + OFFLINE_PROGRESS_SCAN_BATCH)
      const available = await Promise.all(batch.map((index) => blobs.core.has(index)))
      available.forEach((hasBlock, index) => {
        if (hasBlock) markCompleted(batch[index])
      })
    }

    const onDownload = (index) => markCompleted(index)
    blobs.core.on('download', onDownload)
    active.progress = {
      downloadedBytes,
      totalBytes,
      percentage: Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100))
    }

    return {
      close: () => blobs.core.off('download', onDownload),
      complete: () => {
        active.progress = { downloadedBytes: totalBytes, totalBytes, percentage: 100 }
      }
    }
  } catch {
    active.progress = null
    return null
  }
}

function addProgressBlock (blocks, indexValue, byteLengthValue) {
  const index = Number(indexValue)
  const byteLength = Number(byteLengthValue)
  if (!Number.isSafeInteger(index) || index < 0) return
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) return
  if (!blocks.has(index)) blocks.set(index, byteLength)
}

function safeByteSum (total, value) {
  return total > Number.MAX_SAFE_INTEGER - value
    ? Number.MAX_SAFE_INTEGER
    : total + value
}

const manager = createHyperOfflineManager({
  runWithRuntime: (address, task) => withHyperRuntimeForAddress(address, task),
  addWantedItem: addWantedHyperOfflineItem,
  listWantedItems: listWantedHyperOfflineItems,
  removeWantedItem: removeWantedHyperOfflineItem
})

export const closeHyperOfflineDownloads = manager.close
export const keepHyperOffline = manager.keep
export const listHyperOffline = manager.list
export const pauseHyperOffline = manager.pause
export const removeHyperOffline = manager.remove
export const resumeHyperOffline = manager.resume
export const resumeWantedHyperOffline = manager.resumeAll
export const hyperOfflineNetworkAllowed = manager.networkAllowed

function success (item, status, details = {}) {
  return { ok: true, item: { ...item, status, ...details } }
}

function failure (error) {
  return { ok: false, error: normalizeError(error) }
}

function resultItem (result) {
  return result.error ? { ...result.item, error: result.error } : result.item
}

function normalizeError (error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 200)
}

async function clearCachedFolder (runWithRuntime, item, retainedItems) {
  const retainedPaths = retainedItems
    .filter((candidate) => candidate.driveKey === item.driveKey)
    .map((candidate) => candidate.path)
  let clearedFiles = 0
  let clearedBytes = 0

  await runWithRuntime(`hyper://${item.driveKey}/`, async (runtime) => {
    const drive = await runtime.getDrive(`hyper://${item.driveKey}/`, { autoJoin: false })
    for await (const entry of drive.list(item.path, { wait: false })) {
      if (!entry?.value?.blob || retainedPaths.some((path) => entry.key.startsWith(path))) continue
      const result = await drive.clear(entry.key, { diff: true })
      if (!result?.blocks) continue
      clearedFiles += 1
      clearedBytes += Number(entry.value.blob.byteLength) || 0
    }
  })

  return { clearedFiles, clearedBytes }
}
