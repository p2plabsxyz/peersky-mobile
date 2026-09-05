import http from 'bare-http1'
import {
  connectHolesail,
  getHolesailStatus,
  startHolesailLive,
  stopHolesail
} from '../holesail/session.mjs'
import {
  getAvailableLoopbackPort,
  P2PMD_LOOPBACK_HOST
} from './network.mjs'
import { connectWithPreferredLoopbackPort } from './connect.mjs'
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

const JOIN_READY_ATTEMPTS = 12
const JOIN_READY_DELAY_MS = 500
const JOIN_READY_REQUEST_TIMEOUT_MS = 3000

let room = null
let roomTransition = Promise.resolve()

export async function createP2pmdRoom ({
  connector,
  secure = true,
  udp = false,
  log = false
} = {}) {
  return withRoomTransition(async () => {
    await disconnectRoomInternal()

    if (connector) {
      const snapshot = loadP2pmdRoomSnapshot(connector)
      if (snapshot) {
        const restored = updateDocumentState(snapshot.content, snapshot.lineAttributions)
        if (!restored.ok) return restored
      }
    }

    const serverResult = await startP2pmdServer()
    if (!serverResult.ok) return serverResult

    try {
      const holesailResult = await startHolesailLive({
        host: serverResult.host,
        port: serverResult.port,
        connector,
        secure,
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
        secure: Boolean(secure),
        udp: Boolean(udp)
      }

      if (connector && room.key !== connector.trim()) {
        await Promise.allSettled([stopHolesail(), stopP2pmdServer()])
        room = null
        resetDocumentState()
        return { ok: false, error: 'Unable to restore the original P2PMD room key.' }
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
  log = false
} = {}) {
  return withRoomTransition(async () => {
    await disconnectRoomInternal()

    const holesailResult = await connectWithPreferredLoopbackPort({
      connect: connectHolesail,
      getAvailablePort: getAvailableLoopbackPort,
      key,
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
      await waitForJoinedRoomReady(boundPort)
    } catch (error) {
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

async function waitForJoinedRoomReady (port) {
  let lastError = null

  for (let attempt = 0; attempt < JOIN_READY_ATTEMPTS; attempt++) {
    try {
      if (await requestP2pmdStatus(port)) return
    } catch (error) {
      lastError = error
    }

    await delay(JOIN_READY_DELAY_MS)
  }

  throw new Error(lastError?.message || 'Timed out waiting for joined P2PMD room.')
}

function requestP2pmdStatus (port) {
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
    }, JOIN_READY_REQUEST_TIMEOUT_MS)
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
