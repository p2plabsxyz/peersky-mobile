// The phone's P2PMD host for the load test: createP2pmdHttpServer from
// backend/p2pmd/server.mjs on Node's http, the way
// test/protocol/p2pmd-http.test.mjs runs it, bound to 127.0.0.1.
// startP2pmdServer is not used, and nothing here starts Holesail. run.mjs
// starts this process and asks it for measurements.
import dc from 'node:diagnostics_channel'
import http from 'node:http'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { LOOPBACK_TOKEN_HEADER, createLoopbackToken } from '../../../backend/loopback-request.mjs'
import { resetDocumentState } from '../../../backend/p2pmd/document.mjs'
import { createP2pmdHttpServer } from '../../../backend/p2pmd/server.mjs'

const LOOP_EVERY_MS = 10

const meter = createMeter()
resetDocumentState()
const token = createLoopbackToken()
const server = createP2pmdHttpServer({ httpImpl: http, token })
// Each editor stands for someone who joined with the note's address. The
// note's tunnel puts the server's token on their requests, so it goes on here,
// and run.mjs and editors.mjs stay the same as the desktop's.
server.prependListener('request', (req) => {
  req.headers[LOOPBACK_TOKEN_HEADER.toLowerCase()] = token
})
const url = await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})

answer({
  sample: ({ reset }) => meter.sample(reset),
  async close () {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    return {}
  }
})
process.send({ type: 'ready', url, host: 'phone' })

// What the host process does: bytes on every connection it accepts, CPU time,
// memory, and how late its event loop runs.
function createMeter () {
  const open = new Set()
  const closed = { read: 0, written: 0 }
  dc.subscribe('net.server.socket', ({ socket }) => {
    open.add(socket)
    socket.once('close', () => {
      open.delete(socket)
      closed.read += socket.bytesRead
      closed.written += socket.bytesWritten
    })
  })
  const loop = monitorEventLoopDelay({ resolution: LOOP_EVERY_MS })
  loop.enable()
  let peakRss = 0
  const watchMemory = () => { peakRss = Math.max(peakRss, process.memoryUsage.rss()) }
  setInterval(watchMemory, 250).unref()

  // Totals so far, and the peaks since the last reset.
  return {
    sample (reset) {
      watchMemory()
      let read = closed.read
      let written = closed.written
      for (const socket of open) {
        read += socket.bytesRead
        written += socket.bytesWritten
      }
      const cpu = process.cpuUsage()
      const memory = process.memoryUsage()
      const result = {
        at: performance.timeOrigin + performance.now(),
        cpuMicros: cpu.user + cpu.system,
        read,
        written,
        rss: memory.rss,
        peakRss,
        heapUsed: memory.heapUsed,
        loopP99: lateness(loop.percentile(99)),
        loopMax: lateness(loop.max)
      }
      if (reset) {
        peakRss = memory.rss
        loop.reset()
      }
      return result
    }
  }
}

// How late the event loop ran: the histogram counts the sampling interval too.
function lateness (nanoseconds) {
  return Math.max(0, nanoseconds / 1e6 - LOOP_EVERY_MS)
}

function answer (handlers) {
  process.on('message', async (message) => {
    let reply
    try {
      reply = { ...(await handlers[message.type](message)), id: message.id }
    } catch (error) {
      reply = { id: message.id, error: error.message }
    }
    process.send(reply)
  })
  process.on('disconnect', () => process.exit(0))
}
