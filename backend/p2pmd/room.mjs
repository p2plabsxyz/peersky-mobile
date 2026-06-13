import {
  getHolesailStatus,
  startHolesailLive,
  stopHolesail
} from '../holesail/session.mjs'
import {
  getP2pmdServerStatus,
  startP2pmdServer,
  stopP2pmdServer
} from './server.mjs'

let room = null
let roomTransition = Promise.resolve()

export async function createP2pmdRoom ({
  secure = true,
  udp = false,
  log = false
} = {}) {
  return withRoomTransition(async () => {
    await disconnectRoomInternal()

    const serverResult = await startP2pmdServer()
    if (!serverResult.ok) return serverResult

    try {
      const holesailResult = await startHolesailLive({
        host: serverResult.host,
        port: serverResult.port,
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
  const running = serverStatus.running === true && holesailStatus.running === true

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
  const results = await Promise.allSettled([
    stopHolesail(),
    stopP2pmdServer()
  ])

  room = null

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
