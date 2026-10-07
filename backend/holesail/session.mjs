import { TunnelGuest, TunnelHost } from './tunnel.mjs'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])
const UDP_UNSUPPORTED = 'PeerSky shares notes over TCP only.'

let session = null
let mode = null
let sessionTransition = Promise.resolve()

export async function startHolesailLive ({
  port,
  host,
  connector,
  secure = true,
  udp = false
} = {}) {
  return withSessionTransition(async () => {
    if (udp) return { ok: false, error: UDP_UNSUPPORTED }

    const livePort = resolvePort(port, 8989)
    if (!livePort.ok) return livePort

    const liveHost = normalizeHost(host, '127.0.0.1')
    if (!liveHost.ok) return liveHost

    if (!isLoopbackHost(liveHost.host)) {
      return {
        ok: false,
        error: 'Host must be loopback (127.0.0.1, ::1, or localhost)'
      }
    }

    const connectorKey = normalizeHolesailKey(connector, true)
    if (!connectorKey.ok) return connectorKey

    await stopSessionInternal()

    const instance = new TunnelHost({
      key: connectorKey.key,
      secure: Boolean(secure),
      port: livePort.port,
      host: liveHost.host
    })

    session = instance

    try {
      await instance.open()
    } catch (error) {
      session = null
      mode = null

      try {
        await instance.close()
      } catch (closeError) {
        console.error('[holesail] Failed to close session after start error:', closeError)
      }

      throw error
    }

    mode = 'server'

    return {
      ok: true,
      mode,
      info: session.info
    }
  })
}

export async function connectHolesail ({
  key,
  port,
  host,
  // Listen on a port the system picks, for when the port a host advertises
  // belongs to something else on this phone.
  anyPort = false,
  // Listen on the port the host advertises, as the desktop does, so a note's
  // address reads the same on every device. The host's record has it.
  hostPort = false,
  udp = false
} = {}) {
  return withSessionTransition(async () => {
    if (udp) return { ok: false, error: UDP_UNSUPPORTED }

    const targetKey = normalizeHolesailKey(key, false)
    if (!targetKey.ok) return targetKey

    const targetPort = anyPort
      ? { ok: true, port: 0 }
      : hostPort && (port === undefined || port === null)
        ? { ok: true, port: undefined }
        : resolvePort(port, 8989)
    if (!targetPort.ok) return targetPort

    const targetHost = normalizeHost(host, '127.0.0.1')
    if (!targetHost.ok) return targetHost
    if (!isLoopbackHost(targetHost.host)) {
      return {
        ok: false,
        error: 'Host must be loopback (127.0.0.1, ::1, or localhost)'
      }
    }

    let instance
    try {
      instance = new TunnelGuest({
        key: targetKey.key,
        host: targetHost.host,
        port: targetPort.port
      })
    } catch {
      return { ok: false, error: 'Invalid holesail key. Use hs://... or an alphanumeric key.' }
    }

    await stopSessionInternal()

    session = instance

    try {
      await instance.open()
    } catch (error) {
      session = null
      mode = null

      try {
        await instance.close()
      } catch (closeError) {
        console.error('[holesail] Failed to close session after connect error:', closeError)
      }

      // A port already in use here is an answer, not a crash.
      if (error?.code === 'EADDRINUSE') {
        return {
          ok: false,
          error: Number.isInteger(error.port) && error.port > 0
            ? `Port ${error.port} is already in use on this device.`
            : 'That port is already in use on this device.'
        }
      }
      if (error?.code === 'UDP_NOTE') return { ok: false, error: error.message }

      throw error
    }

    mode = 'client'

    return {
      ok: true,
      mode,
      info: session.info
    }
  })
}

export function getHolesailStatus () {
  if (!session) {
    return {
      ok: true,
      running: false,
      mode: null
    }
  }

  return {
    ok: true,
    running: true,
    mode,
    info: session.info
  }
}

export async function stopHolesail () {
  return withSessionTransition(stopSessionInternal)
}

async function stopSessionInternal () {
  if (!session) {
    return { ok: true, running: false, mode: null }
  }

  const existing = session
  session = null

  try {
    await existing.close()
  } finally {
    mode = null
  }

  return { ok: true, running: false, mode: null }
}

async function withSessionTransition (operation) {
  const previousTransition = sessionTransition
  let release

  sessionTransition = new Promise((resolve) => {
    release = resolve
  })

  await previousTransition

  try {
    return await operation()
  } finally {
    release()
  }
}

function resolvePort (value, fallback) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, port: fallback }
  }

  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return {
      ok: false,
      error: 'Invalid port. Expected an integer between 1 and 65535.'
    }
  }

  return { ok: true, port: numeric }
}

function normalizeHost (value, fallback) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, host: fallback }
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid host. Expected a non-empty string.' }
  }

  const candidate = value.trim()
  if (!candidate) {
    return { ok: true, host: fallback }
  }

  if (!isValidHost(candidate)) {
    return {
      ok: false,
      error: 'Invalid host. Use localhost, a valid IP, or a DNS hostname.'
    }
  }

  return { ok: true, host: candidate }
}

function normalizeHolesailKey (value, optional) {
  if (value === undefined || value === null || value === '') {
    if (optional) return { ok: true, key: undefined }
    return { ok: false, error: 'Missing holesail key' }
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid holesail key' }
  }

  const key = value.trim()
  if (!key) {
    if (optional) return { ok: true, key: undefined }
    return { ok: false, error: 'Missing holesail key' }
  }

  const isHsUrl = /^hs:\/\/[A-Za-z0-9]+$/.test(key)
  const isRawKey = /^[A-Za-z0-9]+$/.test(key)

  if (!isHsUrl && !isRawKey) {
    return {
      ok: false,
      error: 'Invalid holesail key. Use hs://... or an alphanumeric key.'
    }
  }

  return { ok: true, key }
}

function isValidHost (value) {
  if (value === 'localhost') return true

  const ipv4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
  if (ipv4.test(value)) return true

  if (isValidIpv6(value)) return true

  const hostname = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/
  return hostname.test(value)
}

function isLoopbackHost (value) {
  if (typeof value !== 'string') return false

  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (LOOPBACK_HOSTS.has(normalized)) return true

  return normalized === '[::1]'
}

function isValidIpv6 (value) {
  if (typeof value !== 'string') return false

  let candidate = value.trim()
  if (!candidate || !candidate.includes(':')) return false

  if (candidate.startsWith('[') || candidate.endsWith(']')) {
    if (!(candidate.startsWith('[') && candidate.endsWith(']'))) return false
    candidate = candidate.slice(1, -1)
  }

  if (!candidate) return false

  const hasCompression = candidate.includes('::')
  if (hasCompression && candidate.split('::').length > 2) return false

  if (!/^[A-Fa-f0-9:]+$/.test(candidate)) return false

  if (hasCompression) {
    const [left, right] = candidate.split('::')
    const leftGroups = left ? left.split(':') : []
    const rightGroups = right ? right.split(':') : []

    if (leftGroups.some((group) => group.length === 0) || rightGroups.some((group) => group.length === 0)) {
      return false
    }

    if (!leftGroups.every(isValidIpv6Group) || !rightGroups.every(isValidIpv6Group)) {
      return false
    }

    return leftGroups.length + rightGroups.length < 8
  }

  const groups = candidate.split(':')
  if (groups.length !== 8) return false
  return groups.every(isValidIpv6Group)
}

function isValidIpv6Group (group) {
  return group.length >= 1 && group.length <= 4 && /^[A-Fa-f0-9]+$/.test(group)
}
