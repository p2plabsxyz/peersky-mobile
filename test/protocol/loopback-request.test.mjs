import assert from 'node:assert/strict'
import test from 'node:test'

import { isOwnLoopbackRequest } from '../../backend/loopback-request.mjs'

const request = (headers) => ({ headers })

test('a server answers its own origin', () => {
  assert.equal(isOwnLoopbackRequest(request({ host: '127.0.0.1:5000' })), true)
  assert.equal(isOwnLoopbackRequest(request({ host: '127.0.0.1:5000', 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(isOwnLoopbackRequest(request({ host: '127.0.0.1:5000', 'sec-fetch-site': 'none' })), true)
  assert.equal(isOwnLoopbackRequest(request({ host: '127.0.0.1:5000', origin: 'http://127.0.0.1:5000' })), true)
  assert.equal(isOwnLoopbackRequest(request({ host: 'localhost:5000', origin: 'http://localhost:5000' })), true)
  assert.equal(isOwnLoopbackRequest(request({ host: '[::1]:5000', origin: 'http://[::1]:5000' })), true)
  assert.equal(isOwnLoopbackRequest(request({})), true)
})

test('anything else is refused, other loopback servers included', () => {
  for (const headers of [
    { host: 'evil.example:5000' },
    { host: '127.0.0.1:5000', origin: 'https://evil.example' },
    { host: '127.0.0.1:5000', origin: 'http://127.0.0.1:5001' },
    { host: '127.0.0.1:5000', origin: 'http://localhost:5000' },
    { host: '127.0.0.1:5000', origin: 'null' },
    { host: '127.0.0.1:5000', origin: 'peersky://p2p' },
    { host: '127.0.0.1:5000', 'sec-fetch-site': 'cross-site' },
    { host: '127.0.0.1:5000', 'sec-fetch-site': 'same-site' }
  ]) {
    assert.equal(isOwnLoopbackRequest(request(headers)), false, JSON.stringify(headers))
  }
})

test('a server can name other origins it answers', () => {
  const options = { allowOrigins: ['peersky://p2p'] }
  assert.equal(isOwnLoopbackRequest(request({ host: '127.0.0.1:5000', origin: 'peersky://p2p', 'sec-fetch-site': 'cross-site' }), options), true)
  assert.equal(isOwnLoopbackRequest(request({ host: '127.0.0.1:5000', origin: 'peersky://p2p.evil' }), options), false)
  assert.equal(isOwnLoopbackRequest(request({ host: 'evil.example', origin: 'peersky://p2p' }), options), false)
})
