export function createRuntimeCoordinator () {
  let activeOperations = 0
  let maintenanceQueued = 0
  let maintenanceTail = Promise.resolve()
  let resolveIdle = null

  async function runOperation (task) {
    while (maintenanceQueued > 0) await maintenanceTail

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
