export async function initializeContentBlockingRuntime ({
  activateState,
  blocker,
  discardState,
  forceUpdate = false,
  loadActiveState,
  loadNativeState,
  updateState,
  warn = console.warn
}) {
  blocker.setEnabled(false)
  let activeState = await loadActiveState()

  if (activeState) {
    try {
      await loadNativeState(activeState)
      blocker.setEnabled(true)
    } catch (error) {
      warn('Unable to load cached content-blocking lists:', error)
      activeState = null
    }
  }

  let updatedState
  try {
    updatedState = await updateState({ force: forceUpdate || !activeState })
  } catch (error) {
    if (!activeState) throw error
    warn('Unable to update content-blocking lists; using cached rules:', error)
    if (forceUpdate) throw error
    return true
  }

  if (activeState?.snapshotName === updatedState.snapshotName) return true

  try {
    await loadNativeState(updatedState)
    await activateState(updatedState)
    activeState = updatedState
    blocker.setEnabled(true)
  } catch (error) {
    try {
      await discardState(updatedState)
    } catch (discardError) {
      warn('Unable to discard rejected content-blocking lists:', discardError)
    }
    if (!activeState) throw error

    try {
      await loadNativeState(activeState)
      blocker.setEnabled(true)
    } catch (rollbackError) {
      blocker.setEnabled(false)
      warn('Unable to restore cached content-blocking lists:', rollbackError)
      throw error
    }

    warn('Unable to activate updated content-blocking lists; using cached rules:', error)
    if (forceUpdate) throw error
  }

  return true
}

export function createForcedUpdateCoordinator (runUpdate, now = Date.now) {
  let inFlight = null

  return function coordinateUpdate ({ force = false, now: requestedAt = now() } = {}) {
    if (inFlight && (!force || inFlight.forced)) return inFlight.promise

    const pending = inFlight?.promise
    const operation = pending
      ? pending.catch(() => undefined).then(() => runUpdate({
        force: true,
        now: now()
      }))
      : runUpdate({ force, now: requestedAt })
    const update = {
      forced: force,
      promise: Promise.resolve(operation)
    }

    update.promise = update.promise.finally(() => {
      if (inFlight === update) inFlight = null
    })
    inFlight = update
    return update.promise
  }
}
