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
  const livePort = toPort(port, 8989)
  const liveHost = typeof host === 'string' && host.trim() ? host.trim() : '127.0.0.1'
  const key = typeof connector === 'string' && connector.trim()
    ? connector.trim()
    : undefined

  await stopHolesail()

  session = new Holesail({
    server: true,
    secure: Boolean(secure),
    udp: Boolean(udp),
    log,
    port: livePort,
    host: liveHost,
    key
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
  if (!key || typeof key !== 'string' || !key.trim()) {
    return { ok: false, error: 'Missing holesail key' }
  }

  const targetPort = toPort(port, 8989)
  const targetHost = typeof host === 'string' && host.trim() ? host.trim() : '127.0.0.1'

  await stopHolesail()

  session = new Holesail({
    client: true,
    key: key.trim(),
    udp: Boolean(udp),
    log,
    port: targetPort,
    host: targetHost
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

function toPort (value, fallback) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric)) return fallback
  if (numeric < 1 || numeric > 65535) return fallback
  return numeric
}
