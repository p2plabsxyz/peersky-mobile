export function createRuntimeCoordinator () {
  let activeOperations = 0
  let maintenanceQueued = 0
  let maintenanceTail = Promise.resolve()
  let resolveIdle = null

  async function runOperation (task) {
    if (maintenanceQueued > 0) {
      let pendingMaintenance
      do {
        pendingMaintenance = maintenanceTail
        await pendingMaintenance
      } while (pendingMaintenance !== maintenanceTail)
    }

    activeOperations += 1
    try {
      return await task()
    } finally {
      activeOperations -= 1
      if (activeOperations === 0 && resolveIdle) {
        const resolve = resolveIdle
        resolveIdle = null
        resolve()
      }
    }
  }

  function runMaintenance (task) {
    maintenanceQueued += 1
    const run = maintenanceTail.then(async () => {
      if (activeOperations > 0) {
        await new Promise((resolve) => { resolveIdle = resolve })
      }
      return task()
    })

    maintenanceTail = run.catch(() => {})
    return run.finally(() => { maintenanceQueued -= 1 })
  }

  return { runMaintenance, runOperation }
}

export async function closeRuntimeCandidates (candidates) {
  const openings = await Promise.allSettled(candidates.filter(Boolean))
  const runtimes = [...new Set(
    openings
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => result.value)
  )]
  const closings = await Promise.allSettled(
    runtimes.map((runtime) => runtime.close())
  )
  const failure = openings.find((result) => result.status === 'rejected') ||
    closings.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

export async function initializeRuntimeCandidate (createRuntime, configure) {
  const runtime = await createRuntime()
  try {
    await configure(runtime)
    return runtime
  } catch (error) {
    try { await runtime.close() } catch {}
    throw error
  }
}
