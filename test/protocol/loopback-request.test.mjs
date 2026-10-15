import assert from 'node:assert/strict'
import test from 'node:test'

import { createLoopbackToken, isLoopbackToken, isOwnLoopbackRequest } from '../../backend/loopback-request.mjs'

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

// Another app on the phone reaches these ports too, and sends what headers it
// likes. A server with anything private behind it also wants its token.
test('a token is 32 random bytes in hex, new each time', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => createLoopbackToken()))
  assert.equal(tokens.size, 100)
  for (const token of tokens) assert.match(token, /^[0-9a-f]{64}$/)
})

test('only the token itself counts', () => {
  const token = createLoopbackToken()
  assert.equal(isLoopbackToken(token, token), true)

  for (const value of [
    undefined,
    null,
    '',
    0,
    [token],
    { toString: () => token },
    createLoopbackToken(),
    '0'.repeat(token.length),
    token.slice(1),
    `${token}0`,
    `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`
  ]) {
    assert.equal(isLoopbackToken(value, token), false, String(value))
  }

  // Nothing matches a server that has no token.
  assert.equal(isLoopbackToken('', ''), false)
  assert.equal(isLoopbackToken(undefined, undefined), false)
  assert.equal(isLoopbackToken(token, null), false)
})
