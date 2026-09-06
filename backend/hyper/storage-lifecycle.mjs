export async function runP2pCacheClear ({
  getRuntime,
  storagePath,
  stopAssetServer,
  closeRuntime,
  resetFetch,
  createStore,
  clearStore,
  removeArchive
}) {
  await getRuntime()
  if (!storagePath) return { ok: false, error: 'Hyper storage is unavailable.' }

  let store = null
  let result

  try {
    await stopAssetServer()
    await closeRuntime()
    resetFetch()

    store = createStore(storagePath)
    await store.ready()
    result = await clearStore(store)
    if (result?.ok && removeArchive) {
      result = await appendCleanupWarning(
        result,
        removeArchive,
        'Downloaded data was cleared, but its archive metadata could not be removed.'
      )
    }
  } finally {
    try {
      if (store) await store.close()
    } finally {
      await getRuntime()
    }
  }

  return result
}

export async function runP2pDataClear ({
  getRuntime,
  getStoragePath,
  stopAssetServer,
  closeRuntime,
  resetFetch,
  removeStorage,
  clearArchive
}) {
  await getRuntime()
  const storagePath = getStoragePath()
  if (!storagePath) return { ok: false, error: 'Hyper storage is unavailable.' }

  let result = { ok: true, cleared: true }

  try {
    await stopAssetServer()
    await closeRuntime()
    resetFetch()
    removeStorage(storagePath)
    result = await appendCleanupWarning(
      result,
      () => clearArchive(storagePath),
      'Hyper data was cleared, but its archive metadata could not be removed.'
    )
  } finally {
    await getRuntime()
  }

  return result
}

export function runP2pAppDataDelete ({
  runExclusive,
  getRuntime,
  deleteAppData,
  removeArchive,
  appId
}) {
  return runExclusive(async () => {
    const result = await deleteAppData(await getRuntime(), { appId })
    if (!result?.ok || !result.deleted) return result

    return appendCleanupWarning(
      result,
      () => removeArchive({ appId }),
      'App data was deleted, but its archive metadata could not be removed.'
    )
  })
}

export function removeHyperStoragePaths ({
  storagePath,
  privateStoragePath,
  syncedPrivateStoragePath,
  removeStorage
}) {
  removeStorage(storagePath)
  if (privateStoragePath && privateStoragePath !== storagePath) {
    removeStorage(privateStoragePath)
  }
  if (syncedPrivateStoragePath && syncedPrivateStoragePath !== storagePath) {
    removeStorage(syncedPrivateStoragePath)
  }
}

async function appendCleanupWarning (result, cleanup, message) {
  try {
    const cleaned = await cleanup()
    if (cleaned === false) throw new Error('The cleanup was not persisted.')
    return result
  } catch (error) {
    return {
      ...result,
      warning: `${message} ${normalizeError(error)}`
    }
  }
}

function normalizeError (error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 200)
}
