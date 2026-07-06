import process from 'node:process'
import {
  getHolesailStatus,
  startHolesailLive,
  stopHolesail
} from '../../backend/holesail/session.mjs'

const port = Number(process.argv[2])
const host = process.argv[3] || '127.0.0.1'

if (!Number.isInteger(port) || port < 1) {
  throw new Error('Expected origin port argument')
}

let stopped = false

async function stop () {
  if (stopped) return
  stopped = true
  await stopHolesail()
}

process.on('message', async (message) => {
  if (message?.type === 'status') {
    process.send?.({ type: 'status', status: getHolesailStatus() })
    return
  }

  if (message?.type === 'stop') {
    await stop()
    process.send?.({ type: 'stopped' })
  }
})

process.on('disconnect', () => {
  stop()
    .catch(() => {})
    .finally(() => process.exit(0))
})

const result = await startHolesailLive({
  host,
  port,
  secure: true,
  udp: false,
  log: false
})

if (!result.ok) {
  process.send?.({ type: 'error', error: result.error || 'Unable to start Holesail live session' })
  process.exit(1)
}

process.send?.({
  type: 'ready',
  info: result.info
})
