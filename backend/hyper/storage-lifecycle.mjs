export async function runP2pCacheClear ({
  getRuntime,
  storagePath,
  stopAssetServer,
  closeServices = async () => {},
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
    await closeP2pStorageUsers({
      stopAssetServer,
      closeServices,
      closeRuntime,
      resetFetch
    })

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

// holdStores keeps every store shut from before they close until the removal
// is done, and hands back what lets them open again. PeerChat and its
// notifications open the runtime directly, not through the maintenance
// window, and one landing part way through would open a store being removed.
export async function runP2pDataClear ({
  getRuntime,
  getStoragePath,
  holdStores = () => () => {},
  stopAssetServer,
  closeServices = async () => {},
  closeRuntime,
  resetFetch,
  removeStorage,
  clearArchive
}) {
  await getRuntime()
  const storagePath = getStoragePath()
  if (!storagePath) return { ok: false, error: 'Hyper storage is unavailable.' }

  let result = { ok: true, cleared: true }
  const release = holdStores()

  try {
    await closeP2pStorageUsers({
      stopAssetServer,
      closeServices,
      closeRuntime,
      resetFetch
    })
    const removal = await removeStorage(storagePath)
    if (removal?.warning) result = { ...result, warning: removal.warning }
    result = await appendCleanupWarning(
      result,
      () => clearArchive(storagePath),
      'Hyper data was cleared, but its archive metadata could not be removed.'
    )
  } finally {
    release()
    await getRuntime()
  }

  return result
}

/**
 * Clear all P2P data, and this device's identity with it. Marked as asked for
 * before anything is touched, so a clear the app is killed in is finished on
 * its next start (p2p-reset.mjs). Link Device first lets go of a restore that
 * is waiting and takes down a transfer going out, which needs the stores
 * open, and a note this phone hosts stops writing its copy. The rest happens
 * in one maintenance window.
 */
export async function runP2pIdentityClear ({
  beginReset,
  stopLinkDevice,
  disconnectNotes = async () => {},
  runMaintenance = (task) => task(),
  clearData
}) {
  beginReset()
  await stopLinkDevice()
  try {
    await disconnectNotes()
  } catch (error) {
    // The note is let go of either way, and what it held goes with the store.
    console.warn('[hyper] A hosted note did not close cleanly before clearing:', normalizeError(error))
  }
  return runMaintenance(clearData)
}

export async function closeP2pStorageUsers ({
  stopAssetServer,
  closeServices,
  closeRuntime,
  resetFetch
}) {
  let firstError = null
  for (const action of [stopAssetServer, closeServices, closeRuntime, resetFetch]) {
    try {
      await action()
    } catch (error) {
      if (!firstError) firstError = error
    }
  }
  if (firstError) throw firstError
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
