import process from 'node:process'
import {
  connectHolesail,
  getHolesailStatus,
  stopHolesail
} from '../../backend/holesail/session.mjs'

const key = process.argv[2]
const port = Number(process.argv[3])
const host = process.argv[4] || '127.0.0.1'

if (typeof key !== 'string' || !key.startsWith('hs://')) {
  throw new Error('Expected hs:// key argument')
}

if (!Number.isInteger(port) || port < 1) {
  throw new Error('Expected proxy port argument')
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

const result = await connectHolesail({
  key,
  host,
  port,
  udp: false,
  log: false
})

if (!result.ok) {
  process.send?.({ type: 'error', error: result.error || 'Unable to connect Holesail client session' })
  process.exit(1)
}

process.send?.({
  type: 'ready',
  info: result.info
})
