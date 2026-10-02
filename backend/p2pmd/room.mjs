import http from 'bare-http1'
import {
  connectHolesail,
  getHolesailStatus,
  startHolesailLive,
  stopHolesail
} from '../holesail/session.mjs'
import { P2PMD_LOOPBACK_HOST } from './constants.mjs'
import {
  getP2pmdServerStatus,
  startP2pmdServer,
  stopP2pmdServer
} from './server.mjs'
import {
  getDocumentState,
  resetDocumentState,
  updateDocumentState
} from './document.mjs'
import {
  activateP2pmdRoomSnapshot,
  deactivateP2pmdRoomSnapshot,
  loadP2pmdRoomSnapshot
} from './snapshots.mjs'
import {
  createPublicNoteSeed,
  findPublicNoteSeed,
  isPublicNoteKey,
  rememberPublicNoteSeed
} from './public-notes.mjs'

const JOIN_READY_ATTEMPTS = 12
const JOIN_READY_DELAY_MS = 500
const JOIN_READY_REQUEST_TIMEOUT_MS = 3000
// How long a shared note is looked for on the person's other devices before
// this phone hosts its own copy.
const SHARED_NOTE_LOOK_MS = 8000

let room = null
let roomTransition = Promise.resolve()

export async function createP2pmdRoom ({
  connector,
  secure = true,
  udp = false,
  log = false,
  // Hosting a shared note nobody else has open: only from a copy. Without
  // one, an empty note would go up in place of the real one.
  requireCopy = false
} = {}) {
  return withRoomTransition(async () => {
    await disconnectRoomInternal()

    // A private note hosts from its own key. A public one hosts from the seed
    // it was made from, which only the phone that made it keeps.
    let hostKey = connector
    let publicSeed = null
    if (connector && isPublicNoteKey(connector)) {
      publicSeed = findPublicNoteSeed(connector)
      if (!publicSeed) {
        return {
          ok: false,
          error: 'This phone can no longer host this public note. Only the phone that made a public note can host it.'
        }
      }
      hostKey = publicSeed
    } else if (!connector && !secure) {
      publicSeed = createPublicNoteSeed()
      hostKey = publicSeed
    }
    const isPrivate = !publicSeed

    if (connector) {
      const snapshot = loadP2pmdRoomSnapshot(connector)
      if (snapshot) {
        const restored = updateDocumentState(snapshot.content, snapshot.lineAttributions)
        if (!restored.ok) return restored
      } else if (requireCopy) {
        return {
          ok: false,
          error: 'Nobody has this note open right now, and there is no copy of it on this phone.'
        }
      }
    }

    const serverResult = await startP2pmdServer()
    if (!serverResult.ok) return serverResult

    try {
      const holesailResult = await startHolesailLive({
        host: serverResult.host,
        port: serverResult.port,
        connector: hostKey,
        secure: isPrivate,
        udp,
        log
      })

      if (!holesailResult.ok) {
        await stopP2pmdServer()
        return holesailResult
      }

      const key = holesailResult.info?.url
      if (typeof key !== 'string' || !key) {
        await stopHolesail()
        await stopP2pmdServer()
        return {
          ok: false,
          error: 'Holesail started without a shareable room key.'
        }
      }

      room = {
        key,
        role: 'host',
        localUrl: serverResult.localUrl,
        host: serverResult.host,
        port: serverResult.port,
        secure: isPrivate,
        udp: Boolean(udp)
      }

      if (connector && room.key !== connector.trim()) {
        await Promise.allSettled([stopHolesail(), stopP2pmdServer()])
        room = null
        resetDocumentState()
        return { ok: false, error: 'Unable to restore the original P2PMD room key.' }
      }

      // Without its seed a new public note could never be opened again, so it
      // is kept before anyone is handed the key. Reopening one marks it used.
      if (publicSeed && !rememberPublicNoteSeed(room.key, publicSeed) && !connector) {
        await Promise.allSettled([stopHolesail(), stopP2pmdServer()])
        room = null
        resetDocumentState()
        return { ok: false, error: 'Unable to keep this public note on the phone, so it was not opened.' }
      }

      activateP2pmdRoomSnapshot(room.key, getDocumentState())

      return {
        ok: true,
        running: true,
        room: { ...room }
      }
    } catch (error) {
      await Promise.allSettled([
        stopHolesail(),
        stopP2pmdServer()
      ])
      throw error
    }
  })
}

export async function joinP2pmdRoom ({
  key,
  udp = false,
  log = false,
  // Looking for a shared note on the person's other devices. A join is
  // listening locally whether or not anyone hosts the note, so here a room
  // that does not answer is reported as nobody there, for the caller to host
  // its own copy, instead of being joined and retried.
  probe = false
} = {}) {
  return withRoomTransition(async () => {
    await disconnectRoomInternal()

    const holesailResult = await connectHolesail({
      key,
      anyPort: true,
      udp,
      log
    })

    if (!holesailResult.ok) return holesailResult

    const roomKey = holesailResult.info?.url
    if (typeof roomKey !== 'string' || !roomKey) {
      await stopHolesail()
      return {
        ok: false,
        error: 'Holesail connected without a valid room key.'
      }
    }

    const boundPort = holesailResult.info?.port
    if (!Number.isInteger(boundPort) || boundPort < 1) {
      await stopHolesail()
      return {
        ok: false,
        error: 'Holesail connected without a valid local port.'
      }
    }

    let warning = null
    try {
      await waitForJoinedRoomReady(boundPort, probe ? SHARED_NOTE_LOOK_MS : null)
    } catch (error) {
      if (probe) {
        await stopHolesail()
        return { ok: false, noHost: true, error: 'Nobody has this note open right now.' }
      }
      warning = `Holesail proxy is listening, but the room did not answer readiness checks yet. The editor will keep retrying. (${getErrorMessage(error)})`
    }

    room = {
      key: roomKey,
      role: 'client',
      localUrl: `http://${P2PMD_LOOPBACK_HOST}:${boundPort}`,
      host: P2PMD_LOOPBACK_HOST,
      port: boundPort,
      secure: holesailResult.info?.secure === true,
      udp: Boolean(udp)
    }

    return {
      ok: true,
      running: true,
      room: { ...room },
      warning
    }
  })
}

export function getP2pmdRoomStatus () {
  if (!room) {
    return {
      ok: true,
      running: false,
      room: null
    }
  }

  const serverStatus = getP2pmdServerStatus()
  const holesailStatus = getHolesailStatus()
  const running = room.role === 'host'
    ? serverStatus.running === true && holesailStatus.running === true
    : holesailStatus.running === true

  return {
    ok: true,
    running,
    room: {
      ...room
    }
  }
}

export async function disconnectP2pmdRoom () {
  return withRoomTransition(disconnectRoomInternal)
}

async function disconnectRoomInternal () {
  deactivateP2pmdRoomSnapshot(room?.role === 'host' ? getDocumentState() : null)
  const results = await Promise.allSettled([
    stopHolesail(),
    stopP2pmdServer()
  ])

  room = null
  resetDocumentState()

  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    throw failure.reason
  }

  return {
    ok: true,
    running: false,
    room: null
  }
}

async function withRoomTransition (operation) {
  const previousTransition = roomTransition
  let release

  roomTransition = new Promise((resolve) => {
    release = resolve
  })

  await previousTransition

  try {
    return await operation()
  } finally {
    release()
  }
}

// Tries a fixed number of times, or, given a time budget, until it runs out.
async function waitForJoinedRoomReady (port, budgetMs = null) {
  let lastError = null
  const deadline = budgetMs === null ? null : Date.now() + budgetMs

  for (let attempt = 0; deadline === null ? attempt < JOIN_READY_ATTEMPTS : Date.now() < deadline; attempt++) {
    try {
      const timeoutMs = deadline === null
        ? JOIN_READY_REQUEST_TIMEOUT_MS
        : Math.min(JOIN_READY_REQUEST_TIMEOUT_MS, Math.max(500, deadline - Date.now()))
      if (await requestP2pmdStatus(port, timeoutMs)) return
    } catch (error) {
      lastError = error
    }

    await delay(JOIN_READY_DELAY_MS)
  }

  throw new Error(lastError?.message || 'Timed out waiting for joined P2PMD room.')
}

function requestP2pmdStatus (port, timeoutMs = JOIN_READY_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let body = ''
    let settled = false

    const settle = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(value)
    }

    const req = http.request({
      host: P2PMD_LOOPBACK_HOST,
      port,
      method: 'GET',
      path: '/status'
    }, (res) => {
      res.on('data', (chunk) => {
        body += chunk.toString()
      })
      res.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}')
          settle(null, isReadyStatusResponse(res.statusCode, payload))
        } catch {
          settle(null, false)
        }
      })
      res.on('error', settle)
    })

    req.on('error', settle)
    const timeout = setTimeout(() => {
      try {
        req.destroy()
      } catch {}
      settle(new Error('Timed out probing joined P2PMD room.'))
    }, timeoutMs)
    req.end()
  })
}

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isReadyStatusResponse (statusCode, payload) {
  if (statusCode < 200 || statusCode >= 300) return false

  // Mobile returns { ok: true, service: 'p2pmd', ... } while desktop returns
  // { peers, peerList, activityCount }. so Accept both valid P2PMD status shapes.
  if (payload?.ok === true) return true
  if (Number.isFinite(Number(payload?.peers))) return true
  if (Array.isArray(payload?.peerList)) return true

  return false
}

function getErrorMessage (error) {
  return error instanceof Error ? error.message : String(error)
}
