import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER_FIXTURE = resolve(__dirname, '../fixtures/holesail-live-server.mjs')
const CLIENT_FIXTURE = resolve(__dirname, '../fixtures/holesail-live-client.mjs')
const TEST_TOKEN = `PEERSKY_HOLESAIL_LIVE_${Date.now()}`
const FETCH_ATTEMPTS = 30
const FETCH_DELAY_MS = 500

const children = new Set()
let originServer = null

describe('live Holesail tunnel integration', () => {
  afterEach(async () => {
    await Promise.all(Array.from(children, stopChild))
    children.clear()

    if (originServer) {
      await closeServer(originServer)
      originServer = null
    }
  })

  it('creates a live session, joins it from another runtime, and proxies HTTP traffic', { timeout: 120000 }, async () => {
    const origin = await startOriginServer(TEST_TOKEN)
    originServer = origin.server

    const serverChild = forkFixture(SERVER_FIXTURE, [String(origin.port)])
    const serverReady = await waitForChildMessage(serverChild, 'ready', 60000)
    const roomKey = serverReady.info?.url

    assert.match(roomKey, /^hs:\/\//)

    const proxyPort = await getAvailablePort()
    const clientChild = forkFixture(CLIENT_FIXTURE, [roomKey, String(proxyPort)])
    const clientReady = await waitForChildMessage(clientChild, 'ready', 60000)

    assert.equal(clientReady.info?.port, proxyPort)

    const response = await fetchWithRetry(`http://127.0.0.1:${proxyPort}/proof?via=holesail`)
    const body = await response.text()

    assert.equal(response.status, 200)
    assert.match(body, new RegExp(TEST_TOKEN))
    assert.match(body, /path=\/proof\?via=holesail/)
  })
})

function forkFixture (fixture, args) {
  const child = fork(fixture, args, {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  })

  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[holesail-live:${child.pid}:stderr] ${chunk}`)
  })

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[holesail-live:${child.pid}:stdout] ${chunk}`)
  })

  children.add(child)
  return child
}

function waitForChildMessage (child, expectedType, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${expectedType} from child ${child.pid}`))
    }, timeoutMs)

    const onMessage = (message) => {
      if (message?.type === 'error') {
        cleanup()
        reject(new Error(message.error || `Child ${child.pid} reported an error`))
        return
      }

      if (message?.type === expectedType) {
        cleanup()
        resolve(message)
      }
    }

    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`Child ${child.pid} exited before ${expectedType}; code=${code} signal=${signal}`))
    }

    function cleanup () {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
    }

    child.on('message', onMessage)
    child.on('exit', onExit)
  })
}

async function stopChild (child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return

  try {
    child.send({ type: 'stop' })
    await waitForChildMessage(child, 'stopped', 5000)
  } catch {
    try {
      child.kill()
    } catch {}
  }
}

function startOriginServer (token) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    res.end(`${token}\npath=${req.url}`)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      if (!Number.isInteger(port)) reject(new Error('Origin server did not bind to a port.'))
      else resolve({ server, port })
    })
  })
}

function closeServer (server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function getAvailablePort () {
  const server = net.createServer()

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (!Number.isInteger(port)) reject(new Error('Unable to allocate test port.'))
        else resolve(port)
      })
    })
  })
}

async function fetchWithRetry (url) {
  let lastError = null

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`Unexpected status ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await delay(FETCH_DELAY_MS)
  }

  throw lastError || new Error('Timed out fetching through Holesail tunnel.')
}

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
