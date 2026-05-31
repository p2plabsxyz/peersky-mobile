import Holesail from 'holesail'

let session = null
let mode = null

export async function startHolesailLive ({
  port,
  host,
  connector,
  secure = true,
  udp = false,
  log = false
} = {}) {
  const livePort = resolvePort(port, 8989)
  if (!livePort.ok) return livePort

  const liveHost = normalizeHost(host, '127.0.0.1')
  if (!liveHost.ok) return liveHost

  const connectorKey = normalizeHolesailKey(connector, true)
  if (!connectorKey.ok) return connectorKey

  await stopHolesail()

  session = new Holesail({
    server: true,
    secure: Boolean(secure),
    udp: Boolean(udp),
    log,
    port: livePort.port,
    host: liveHost.host,
    key: connectorKey.key
  })

  await session.ready()
  mode = 'server'

  return {
    ok: true,
    mode,
    info: session.info
  }
}

export async function connectHolesail ({
  key,
  port,
  host,
  udp = false,
  log = false
} = {}) {
  const targetKey = normalizeHolesailKey(key, false)
  if (!targetKey.ok) return targetKey

  const targetPort = resolvePort(port, 8989)
  if (!targetPort.ok) return targetPort

  const targetHost = normalizeHost(host, '127.0.0.1')
  if (!targetHost.ok) return targetHost

  await stopHolesail()

  session = new Holesail({
    client: true,
    key: targetKey.key,
    udp: Boolean(udp),
    log,
    port: targetPort.port,
    host: targetHost.host
  })

  await session.ready()
  mode = 'client'

  return {
    ok: true,
    mode,
    info: session.info
  }
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

  const ipv6Bracketed = /^\[[A-Fa-f0-9:]+\]$/
  if (ipv6Bracketed.test(value)) return true

  const ipv6 = /^[A-Fa-f0-9:]+$/
  if (value.includes(':') && ipv6.test(value)) return true

  const hostname = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/
  return hostname.test(value)
}
