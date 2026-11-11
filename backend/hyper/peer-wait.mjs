// How long the phone looks for someone who has a drive it has never read
// before, and what it says when nobody answers. The Hyperdrive viewer, the
// Hyperdrive tab's Fetch and Keep offline all wait the same way, so none of
// them sits on a spinner for a drive nobody is sharing.

// A fresh install on a slow network can take most of this to find the DHT, the
// drive's topic and a way through both NATs.
export const PEER_WAIT_MS = 30000
export const NO_PEERS_CODE = 'no-peers'
export const NO_PEERS_ERROR = 'Nobody who has this drive could be reached.'

/** The drive's length as far as this phone knows, 0 when it knows nothing. */
export function driveCoreLength (drive) {
  const length = drive?.core?.length ?? drive?.db?.core?.length
  return Number.isSafeInteger(length) ? length : 0
}

/**
 * True for someone else's drive that no peer has said anything about yet.
 * A drive object with no core to ask (as in tests) is never waiting.
 */
export function isAwaitingFirstPeer (drive) {
  if (!drive || drive.writable) return false
  const core = drive.core || drive.db?.core
  return core?.length === 0
}

/**
 * Waits at most timeoutMs for a peer to say how long the drive is. True means
 * there is something to read. The release findingPeers() hands back is what
 * makes update() wait for a peer at all, as the desktop's waitForDriveReady
 * does. signal (createListSignal in the viewer) ends the wait early.
 */
export async function waitForDrivePeer (drive, runtime, {
  timeoutMs = PEER_WAIT_MS,
  refreshNetwork = async () => {},
  signal = null
} = {}) {
  if (drive.writable || driveCoreLength(drive) > 0) return true

  const core = drive.core
  const done = typeof core?.findingPeers === 'function' ? core.findingPeers() : null
  let timer = null
  let stopListening = () => {}
  try {
    if (done) {
      const swarm = runtime?.swarm
      if (typeof swarm?.flush === 'function') Promise.resolve(swarm.flush()).then(done, done)
      else done()
    }
    await Promise.resolve(refreshNetwork(runtime)).catch(() => {})
    await Promise.race([
      Promise.resolve(typeof core?.update === 'function' ? core.update({ wait: true }) : null).catch(() => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
      new Promise((resolve) => { if (signal) stopListening = signal.onAbort(resolve) })
    ])
  } finally {
    clearTimeout(timer)
    stopListening()
    if (done) done()
  }

  return driveCoreLength(drive) > 0
}

/** How many peers this phone is replicating the drive with right now. */
export function drivePeerCount (drive) {
  const peers = drive?.core?.peers ?? drive?.db?.core?.peers
  return Array.isArray(peers) ? peers.length : null
}
