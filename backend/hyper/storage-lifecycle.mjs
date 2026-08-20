export async function runP2pCacheClear ({
  getRuntime,
  storagePath,
  stopAssetServer,
  closeRuntime,
  resetFetch,
  createStore,
  clearStore
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
  } finally {
    try {
      if (store) await store.close()
    } finally {
      await getRuntime()
    }
  }

  return result
}
