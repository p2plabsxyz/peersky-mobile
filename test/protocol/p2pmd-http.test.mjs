import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { buildLineReplaceUpdate } from '../fixtures/yjs-helpers.mjs'
import { resetDocumentState } from '../../backend/p2pmd/document.mjs'
import { createP2pmdHttpServer } from '../../backend/p2pmd/server.mjs'

const activeStreams = new Set()

describe('p2pmd HTTP endpoints with injectable Node server', () => {
  let server
  let localUrl

  beforeEach(async () => {
    resetDocumentState()
    server = createP2pmdHttpServer({ httpImpl: http })
    localUrl = await listen(server)
  })

  afterEach(async () => {
    await Promise.all(Array.from(activeStreams, closeEventStream))
    activeStreams.clear()
    await closeServer(server)
    resetDocumentState()
  })

  it('serves status and CORS preflight responses', async () => {
    const statusResponse = await fetch(`${localUrl}/status`)
    const status = await statusResponse.json()

    assert.equal(statusResponse.status, 200)
    assert.equal(statusResponse.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(statusResponse.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(status, {
      ok: true,
      service: 'p2pmd',
      running: true,
      peers: 0,
      peerList: [],
      activityCount: 0
    })

    const optionsResponse = await fetch(`${localUrl}/status`, { method: 'OPTIONS' })
    assert.equal(optionsResponse.status, 204)
    assert.equal(optionsResponse.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS')
  })

  it('stores and returns full document state through /doc', async () => {
    const postResponse = await postJson(`${localUrl}/doc`, {
      content: 'hello\nfrom endpoint',
      lineAttributions: {
        1: { name: 'Phone', color: '#58a6ff', clientId: 'phone-1' }
      }
    })
    const postBody = await postResponse.json()

    assert.equal(postResponse.status, 200)
    assert.equal(postBody.ok, true)

    const docResponse = await fetch(`${localUrl}/doc`)
    const doc = await docResponse.json()

    assert.equal(docResponse.status, 200)
    assert.equal(doc.content, 'hello\nfrom endpoint')
    assert.deepEqual(doc.lineAttributions, {
      1: { color: '#58a6ff', name: 'Phone', clientId: 'phone-1' }
    })
  })

  it('serves full Yjs state and accepts incremental /doc/update writes', async () => {
    await postJson(`${localUrl}/doc`, { content: 'Line 1: base\nLine 2: base' })

    const stateResponse = await fetch(`${localUrl}/doc/yjsstate`)
    const { yjsState } = await stateResponse.json()
    const update = buildLineReplaceUpdate(yjsState, 'Line 2: base', 'Desktop edited line 2')

    const updateResponse = await postJson(`${localUrl}/doc/update`, {
      clientId: 'desktop-1',
      role: 'client',
      name: 'Desktop',
      color: '#9d4edd',
      lineAttributions: {
        2: { name: 'Desktop', color: '#9d4edd' }
      },
      update
    })
    const updateBody = await updateResponse.json()

    assert.equal(updateResponse.status, 200)
    assert.equal(updateBody.ok, true)
    assert.match(updateBody.document.content, /Desktop edited line 2/)
    assert.deepEqual(updateBody.document.lineAttributions, {
      2: { color: '#9d4edd', name: 'Desktop', clientId: '' }
    })
  })

  it('renders preview HTML and rejects invalid preview input', async () => {
    const response = await postJson(`${localUrl}/preview`, {
      content: '<script>alert(1)</script>\n\n![pic](hyper://example.com/pic.png)'
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.match(body.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(body.html, /src="\/hyper\/file\?url=hyper%3A%2F%2Fexample.com%2Fpic.png"/)

    const invalidResponse = await postJson(`${localUrl}/preview`, { content: 42 })
    const invalidBody = await invalidResponse.json()

    assert.equal(invalidResponse.status, 400)
    assert.equal(invalidBody.ok, false)
    assert.equal(invalidBody.error, 'Invalid Markdown content. Expected a string.')
  })

  it('tracks SSE peers and presence through real HTTP endpoints', async () => {
    const host = await openEventStream(`${localUrl}/events?clientId=host-1&role=host&name=Host&color=%23f2d35b`)
    const client = await openEventStream(`${localUrl}/events?clientId=client-1&role=client&name=Client&color=%2359a6ff`)
    activeStreams.add(host)
    activeStreams.add(client)
    await delay(50)

    let status = await getJson(`${localUrl}/status`)
    assert.equal(status.peers, 1)
    assert.equal(status.peerList.length, 2)

    const presenceResponse = await postJson(`${localUrl}/presence`, {
      clientId: 'client-1',
      role: 'client',
      name: 'Client',
      color: '#59a6ff',
      cursorLine: 2,
      cursorColumn: 4,
      lineAttributions: {
        2: { name: 'Client', color: '#59a6ff' }
      }
    })
    const presence = await presenceResponse.json()

    assert.equal(presenceResponse.status, 200)
    assert.deepEqual(presence, { ok: true, peers: 1 })

    status = await getJson(`${localUrl}/status`)
    const clientPeer = status.peerList.find((peer) => peer.clientId === 'client-1')
    assert.equal(clientPeer.cursorLine, 2)
    assert.deepEqual(clientPeer.lineAttributions, {
      2: { color: '#59a6ff', name: 'Client' }
    })

    await closeEventStream(client)
    activeStreams.delete(client)
    await delay(50)

    status = await getJson(`${localUrl}/status`)
    assert.equal(status.peers, 0)
    assert.equal(status.peerList.some((peer) => peer.clientId === 'client-1'), false)
  })

  it('keeps client edits when the host event stream disconnects and reconnects', async () => {
    await postJson(`${localUrl}/doc`, {
      content: 'Host: Line 1\nHost: Line 2',
      clientId: 'host-device',
      role: 'host',
      name: 'Host'
    })

    let host = await openEventStream(`${localUrl}/events?clientId=host-device&role=host&name=Host&color=%23f2d35b`)
    const client = await openEventStream(`${localUrl}/events?clientId=client-device&role=client&name=Phone&color=%2359a6ff`)
    activeStreams.add(host)
    activeStreams.add(client)

    await postJson(`${localUrl}/presence`, {
      clientId: 'client-device',
      role: 'client',
      name: 'Phone',
      color: '#59a6ff',
      cursorLine: 3,
      cursorColumn: 5,
      lineAttributions: {
        3: { name: 'Phone', color: '#59a6ff' }
      },
      isTyping: true
    })

    let status = await getJson(`${localUrl}/status`)
    let phonePeer = status.peerList.find((peer) => peer.clientId === 'client-device')
    assert.equal(phonePeer.cursorLine, 3)
    assert.deepEqual(phonePeer.lineAttributions, {
      3: { color: '#59a6ff', name: 'Phone' }
    })

    await closeEventStream(host)
    activeStreams.delete(host)
    await delay(50)

    await appendLine(localUrl, 'client-device', 'client', 'Phone', 'Phone: Host is gone')
    await appendLine(localUrl, 'client-device', 'client', 'Phone', 'Phone: Still editing')

    host = await openEventStream(`${localUrl}/events?clientId=host-device&role=host&name=Host&color=%23f2d35b`)
    activeStreams.add(host)

    const doc = await getJson(`${localUrl}/doc`)
    assert.deepEqual(doc.content.split('\n'), [
      'Host: Line 1',
      'Host: Line 2',
      'Phone: Host is gone',
      'Phone: Still editing'
    ])

    status = await getJson(`${localUrl}/status`)
    phonePeer = status.peerList.find((peer) => peer.clientId === 'client-device')
    assert.equal(status.peers, 1)
    assert.equal(phonePeer.lineAttributions['3'].name, 'Phone')
  })

  it('keeps host edits when a client event stream disconnects and reconnects', async () => {
    await postJson(`${localUrl}/doc`, {
      content: 'Shared: Start',
      clientId: 'host-device',
      role: 'host',
      name: 'Host'
    })

    const host = await openEventStream(`${localUrl}/events?clientId=host-device&role=host&name=Host&color=%23f2d35b`)
    let client = await openEventStream(`${localUrl}/events?clientId=client-device&role=client&name=Phone&color=%2359a6ff`)
    activeStreams.add(host)
    activeStreams.add(client)

    await postJson(`${localUrl}/presence`, {
      clientId: 'host-device',
      role: 'host',
      name: 'Host',
      color: '#f2d35b',
      cursorLine: 2,
      cursorColumn: 1,
      lineAttributions: {
        2: { name: 'Host', color: '#f2d35b' }
      },
      isTyping: true
    })

    await closeEventStream(client)
    activeStreams.delete(client)
    await delay(50)

    await appendLine(localUrl, 'host-device', 'host', 'Host', 'Host: Client left, editing alone')
    await appendLine(localUrl, 'host-device', 'host', 'Host', 'Host: More changes')

    client = await openEventStream(`${localUrl}/events?clientId=client-device&role=client&name=Phone&color=%2359a6ff`)
    activeStreams.add(client)

    const doc = await getJson(`${localUrl}/doc`)
    assert.deepEqual(doc.content.split('\n'), [
      'Shared: Start',
      'Host: Client left, editing alone',
      'Host: More changes'
    ])

    const status = await getJson(`${localUrl}/status`)
    assert.equal(status.peers, 1)
    assert.equal(status.peerList.some((peer) => peer.clientId === 'client-device'), true)
  })

  it('preserves edits from two clients when the host reconnects in a three-peer room', async () => {
    await postJson(`${localUrl}/doc`, {
      content: 'Shared: Start',
      clientId: 'host-device',
      role: 'host',
      name: 'Host'
    })

    let host = await openEventStream(`${localUrl}/events?clientId=host-device&role=host&name=Host&color=%23f2d35b`)
    const clientB = await openEventStream(`${localUrl}/events?clientId=device-b&role=client&name=B&color=%233366cc`)
    const clientC = await openEventStream(`${localUrl}/events?clientId=device-c&role=client&name=C&color=%23cc6633`)
    activeStreams.add(host)
    activeStreams.add(clientB)
    activeStreams.add(clientC)

    await postJson(`${localUrl}/presence`, {
      clientId: 'device-b',
      role: 'client',
      name: 'B',
      color: '#3366cc',
      lineAttributions: {
        2: { name: 'B', color: '#3366cc' }
      }
    })
    await postJson(`${localUrl}/presence`, {
      clientId: 'device-c',
      role: 'client',
      name: 'C',
      color: '#cc6633',
      lineAttributions: {
        3: { name: 'C', color: '#cc6633' }
      }
    })

    await closeEventStream(host)
    activeStreams.delete(host)
    await delay(50)

    await appendLine(localUrl, 'device-b', 'client', 'B', 'B: editing')
    await appendLine(localUrl, 'device-c', 'client', 'C', 'C: also editing')

    host = await openEventStream(`${localUrl}/events?clientId=host-device&role=host&name=Host&color=%23f2d35b`)
    activeStreams.add(host)

    const doc = await getJson(`${localUrl}/doc`)
    assert.deepEqual(doc.content.split('\n'), [
      'Shared: Start',
      'B: editing',
      'C: also editing'
    ])

    const status = await getJson(`${localUrl}/status`)
    assert.equal(status.peers, 2)
    assert.equal(status.peerList.some((peer) => peer.clientId === 'device-b'), true)
    assert.equal(status.peerList.some((peer) => peer.clientId === 'device-c'), true)
  })

  it('returns useful errors for bad JSON and unknown endpoints', async () => {
    const badJsonResponse = await fetch(`${localUrl}/doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json'
    })
    const badJson = await badJsonResponse.json()

    assert.equal(badJsonResponse.status, 400)
    assert.deepEqual(badJson, {
      ok: false,
      error: 'Invalid JSON request body.'
    })

    const notFoundResponse = await fetch(`${localUrl}/missing`)
    const notFound = await notFoundResponse.json()

    assert.equal(notFoundResponse.status, 404)
    assert.deepEqual(notFound, {
      ok: false,
      error: 'Not found'
    })
  })
})

function listen (server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      if (!Number.isInteger(port)) reject(new Error('Test server did not bind to a port.'))
      else resolve(`http://127.0.0.1:${port}`)
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

async function getJson (url) {
  const response = await fetch(url)
  assert.equal(response.status, 200)
  return response.json()
}

function postJson (url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function appendLine (localUrl, clientId, role, name, line) {
  const current = await getJson(`${localUrl}/doc`)
  const next = current.content ? `${current.content}\n${line}` : line
  const response = await postJson(`${localUrl}/doc`, {
    content: next,
    clientId,
    role,
    name
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
}

async function openEventStream (url) {
  const response = await fetch(url)
  assert.equal(response.status, 200)
  return {
    reader: response.body?.getReader() || null,
    response
  }
}

async function closeEventStream (stream) {
  if (!stream) return

  try {
    await stream.reader?.cancel()
  } catch {}
}

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
