export function createPrivateHyperRuntimeOptions (storage) {
  return {
    storage,
    autoJoin: false,
    doReplicate: false
  }
}

export function createSyncedPrivateHyperRuntimeOptions (storage) {
  return {
    storage,
    autoJoin: false,
    doReplicate: true
  }
}

export function matchesHyperdriveAddress (address, driveId) {
  if (!driveId) return false

  try {
    return new URL(address).hostname.toLowerCase() === String(driveId).toLowerCase()
  } catch {
    return false
  }
}
