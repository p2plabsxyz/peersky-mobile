export const P2P_APP_DRIVES = [
  { id: 'p2pmd', title: 'P2PMD', driveName: 'p2pmd', autoJoin: true },
  {
    id: 'hyperdrive',
    title: 'Hyperdrive',
    drives: [
      { driveName: 'hyperdrive-public', title: 'Public', autoJoin: true },
      { driveName: 'hyperdrive-private', title: 'Private', autoJoin: false },
      { driveName: 'hyperdrive', title: 'Legacy', autoJoin: true }
    ]
  }
]
export const HYPERDRIVE_APP_DRIVE_NAME = 'hyperdrive'
export const HYPERDRIVE_PUBLIC_DRIVE_NAME = 'hyperdrive-public'
export const HYPERDRIVE_PRIVATE_DRIVE_NAME = 'hyperdrive-private'

const DEFAULT_PAGE_SIZE = 5
const MAX_PAGE_SIZE = 10
const MAX_FILES_PER_APP = 10000
const MAX_CACHE_CORES = 10000
const MAX_APP_SCAN_MS = 500

export function resolveHyperdriveAppDriveName (name) {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  return /^[A-Za-z0-9_-]+$/.test(trimmedName)
    ? trimmedName
    : HYPERDRIVE_APP_DRIVE_NAME
}

export function resolveHyperdriveUploadTarget (visibility) {
  if (visibility === 'public') {
    return { driveName: HYPERDRIVE_PUBLIC_DRIVE_NAME, autoJoin: true }
  }
  if (visibility === 'private') {
    return { driveName: HYPERDRIVE_PRIVATE_DRIVE_NAME, autoJoin: false }
  }
  return null
}

export function createRoutedP2pStorageRuntime (
  networkedRuntime,
  getPrivateRuntime
) {
  return {
    async getExistingDrive (driveName) {
      const runtime = driveName === HYPERDRIVE_PRIVATE_DRIVE_NAME
        ? await getPrivateRuntime()
        : networkedRuntime
      return getExistingNamedDrive(runtime, {
        driveName,
        autoJoin: driveName !== HYPERDRIVE_PRIVATE_DRIVE_NAME
      })
    }
  }
}

export async function listRegisteredP2pAppData (
  runtime,
  { page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}
) {
  const normalizedPageSize = Math.min(
    normalizePositiveInteger(pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  )
  const totalPages = Math.max(1, Math.ceil(P2P_APP_DRIVES.length / normalizedPageSize))
  const normalizedPage = Math.min(normalizePositiveInteger(page, 1), totalPages)
  const start = (normalizedPage - 1) * normalizedPageSize
  const descriptors = P2P_APP_DRIVES.slice(start, start + normalizedPageSize)
  const items = []

  for (const descriptor of descriptors) {
    items.push(await summarizeAppDrive(runtime, descriptor))
  }

  return {
    ok: true,
    items,
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: P2P_APP_DRIVES.length,
    totalPages
  }
}

export async function deleteRegisteredP2pAppData (runtime, { appId } = {}) {
  const descriptor = P2P_APP_DRIVES.find((app) => app.id === appId)
  if (!descriptor) return { ok: false, error: 'Unknown P2P app.' }

  let deleted = false
  for (const target of getDescriptorDrives(descriptor)) {
    const drive = await getExistingNamedDrive(runtime, target)
    if (!drive) continue
    await deleteDriveStorage(drive)
    deleted = true
  }

  return { ok: true, appId: descriptor.id, deleted }
}

export async function clearDownloadedP2pCores (store) {
  const storedCores = []

  for await (const entry of store.storage.createCoreStream()) {
    if (!entry?.discoveryKey || !entry.core) continue
    if (storedCores.length >= MAX_CACHE_CORES) {
      return { ok: false, error: 'P2P cache contains too many data stores to clear safely.' }
    }
    storedCores.push(entry)
  }

  let clearedCores = 0
  let retainedCores = 0
  let failedCores = 0
  let firstError = null

  for (const { discoveryKey, core: storedCore } of storedCores) {
    const core = store.get({ discoveryKey })
    try {
      await core.ready()
      if (core.writable) {
        retainedCores += 1
        await core.close()
      } else {
        await core.close()
        await store.storage.deleteCore(storedCore)
        clearedCores += 1
      }
    } catch (error) {
      failedCores += 1
      if (!firstError) firstError = normalizeError(error)
      try { await core.close() } catch {}
    }
  }

  return {
    ok: failedCores === 0,
    clearedCores,
    retainedCores,
    failedCores,
    error: failedCores > 0
      ? `Some cached Hyper data could not be cleared. ${firstError}`
      : undefined
  }
}

async function summarizeAppDrive (runtime, descriptor) {
  const drives = []
  for (const target of getDescriptorDrives(descriptor)) {
    const drive = await getExistingNamedDrive(runtime, target)
    if (drive) drives.push({ drive, target })
  }
  if (drives.length === 0) {
    return {
      id: descriptor.id,
      title: descriptor.title,
      url: '',
      exists: false,
      fileCount: 0,
      byteLength: 0,
      truncated: false
    }
  }

  let fileCount = 0
  let byteLength = 0
  let truncated = false
  const startedAt = Date.now()
  const driveSummaries = []

  for (const { drive, target } of drives) {
    let driveFileCount = 0
    let driveByteLength = 0
    let driveTruncated = false

    for await (const entry of drive.list('/')) {
      if (!entry?.value || entry.value.linkname) continue
      fileCount += 1
      driveFileCount += 1

      const size = Number(entry.value.blob?.byteLength)
      if (Number.isSafeInteger(size) && size > 0) {
        byteLength += size
        driveByteLength += size
      }

      if (fileCount >= MAX_FILES_PER_APP || Date.now() - startedAt >= MAX_APP_SCAN_MS) {
        truncated = true
        driveTruncated = true
        break
      }
    }

    driveSummaries.push({
      id: target.driveName,
      title: target.title || descriptor.title,
      url: `hyper://${drive.id}/`,
      fileCount: driveFileCount,
      byteLength: driveByteLength,
      truncated: driveTruncated
    })
    if (truncated) break
  }

  return {
    id: descriptor.id,
    title: descriptor.title,
    url: descriptor.drives ? '' : driveSummaries[0].url,
    exists: true,
    fileCount,
    byteLength,
    truncated,
    ...(descriptor.drives ? { drives: driveSummaries } : {})
  }
}

function getDescriptorDrives (descriptor) {
  return descriptor.drives || [{
    driveName: descriptor.driveName,
    autoJoin: descriptor.autoJoin
  }]
}

export async function getExistingNamedDrive (runtime, { driveName, autoJoin = false }) {
  if (typeof runtime.getExistingDrive === 'function') {
    return runtime.getExistingDrive(driveName)
  }

  const namespace = runtime.namespace(driveName)
  const discoveryKey = await namespace.storage.getAlias({
    name: 'db',
    namespace: namespace.ns
  })
  if (!discoveryKey || !await namespace.storage.hasCore(discoveryKey)) return null
  return runtime.getDrive(driveName, { autoJoin })
}

async function deleteDriveStorage (drive) {
  const storage = drive?.corestore?.storage
  if (!storage || !drive.core?.discoveryKey) {
    await drive.purge()
    return
  }

  await drive.ready()
  const discoveryKeys = [drive.core.discoveryKey]
  if (drive.blobs?.core?.discoveryKey) discoveryKeys.push(drive.blobs.core.discoveryKey)

  const storedCores = []
  for await (const entry of storage.createCoreStream()) {
    if (discoveryKeys.some((key) => bytesEqual(key, entry.discoveryKey))) {
      storedCores.push(entry.core)
    }
  }

  await drive.close()
  for (const storedCore of storedCores) await storage.deleteCore(storedCore)
}

function bytesEqual (left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function normalizePositiveInteger (value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function normalizeError (error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 200)
}
