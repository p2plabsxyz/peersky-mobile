import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createHyperBridgeScript,
  HYPER_BRIDGE_CHUNK,
  HYPER_BRIDGE_MAX_BODY_CHARACTERS,
  HYPER_BRIDGE_REQUEST
} from '../../app/hyper-bridge.mjs'
import {
  createHyperBridgeReply,
  createHyperBridgeSettleScript,
  MAX_PENDING_HYPER_BRIDGE_REQUESTS,
  readHyperBridgeMessage
} from '../../app/hyper-bridge-host.mjs'

// There is no WKURLSchemeHandler for hyper://, so a page's own
// fetch('hyper://...') throws before it reaches anything. Desktop registers the
// protocol; the phone routes those calls over the React Native bridge instead.

const TOKEN = 'a'.repeat(32)
const send = (pending, message) => readHyperBridgeMessage(JSON.stringify(message), { token: TOKEN, pending })

test('a request with no body goes straight out', () => {
  const pending = new Map()
  const result = send(pending, {
    type: HYPER_BRIDGE_REQUEST,
    token: TOKEN,
    id: 1,
    url: 'hyper://localhost/?key=myapp',
    method: 'post',
    final: true
  })

  assert.equal(result.kind, 'request')
  assert.equal(result.method, 'POST')
  assert.equal(result.url, 'hyper://localhost/?key=myapp')
  assert.equal(result.body, '')
  assert.equal(pending.size, 0)
})

test('a chunked body is put back together in order', () => {
  const pending = new Map()
  assert.equal(send(pending, { type: HYPER_BRIDGE_CHUNK, token: TOKEN, id: 2, url: 'hyper://drive/a.png', body: 'AAA' }).kind, 'buffered')
  assert.equal(send(pending, { type: HYPER_BRIDGE_CHUNK, token: TOKEN, id: 2, url: 'hyper://drive/a.png', body: 'BBB' }).kind, 'buffered')

  const result = send(pending, {
    type: HYPER_BRIDGE_REQUEST,
    token: TOKEN,
    id: 2,
    url: 'hyper://drive/a.png',
    method: 'PUT',
    body: 'CCC',
    final: true
  })

  assert.equal(result.kind, 'request')
  assert.equal(result.body, 'AAABBBCCC')
  // Nothing is left holding the pieces once the request has gone.
  assert.equal(pending.size, 0)
})

test('two uploads at once do not mix', () => {
  const pending = new Map()
  send(pending, { type: HYPER_BRIDGE_CHUNK, token: TOKEN, id: 3, url: 'hyper://d/a', body: 'aaa' })
  send(pending, { type: HYPER_BRIDGE_CHUNK, token: TOKEN, id: 4, url: 'hyper://d/b', body: 'bbb' })

  const first = send(pending, { type: HYPER_BRIDGE_REQUEST, token: TOKEN, id: 3, url: 'hyper://d/a', method: 'PUT', body: 'ZZZ', final: true })
  assert.equal(first.body, 'aaaZZZ')

  const second = send(pending, { type: HYPER_BRIDGE_REQUEST, token: TOKEN, id: 4, url: 'hyper://d/b', method: 'PUT', body: 'YYY', final: true })
  assert.equal(second.body, 'bbbYYY')
})

test('a message without the page token is ignored', () => {
  const pending = new Map()
  const result = readHyperBridgeMessage(JSON.stringify({
    type: HYPER_BRIDGE_REQUEST,
    token: 'someone else',
    id: 1,
    url: 'hyper://drive/a',
    final: true
  }), { token: TOKEN, pending })

  assert.equal(result.kind, 'ignore')
})

test('anything that is not a bridge message is ignored', () => {
  const pending = new Map()
  assert.equal(readHyperBridgeMessage('not json', { token: TOKEN, pending }).kind, 'ignore')
  assert.equal(send(pending, { type: 'something-else', token: TOKEN, id: 1 }).kind, 'ignore')
  assert.equal(send(pending, { type: HYPER_BRIDGE_REQUEST, token: TOKEN, id: 0, url: 'hyper://d/a' }).kind, 'ignore')
})

test('the bridge carries hyper:// and nothing else', () => {
  const pending = new Map()
  const result = send(pending, {
    type: HYPER_BRIDGE_REQUEST,
    token: TOKEN,
    id: 5,
    url: 'file:///etc/passwd',
    method: 'GET',
    final: true
  })

  assert.equal(result.kind, 'error')
  assert.match(result.error, /Only hyper:\/\//)
})

test('a body past the limit is refused rather than left to stall', () => {
  const pending = new Map()
  const result = send(pending, {
    type: HYPER_BRIDGE_CHUNK,
    token: TOKEN,
    id: 6,
    url: 'hyper://d/big.bin',
    body: 'A'.repeat(HYPER_BRIDGE_MAX_BODY_CHARACTERS + 1)
  })

  assert.equal(result.kind, 'error')
  assert.match(result.error, /too large/)
  assert.equal(pending.size, 0)
})

test('a page cannot pile up half-sent uploads without limit', () => {
  const pending = new Map()
  for (let id = 1; id <= MAX_PENDING_HYPER_BRIDGE_REQUESTS; id += 1) {
    assert.equal(send(pending, { type: HYPER_BRIDGE_CHUNK, token: TOKEN, id, url: 'hyper://d/a', body: 'x' }).kind, 'buffered')
  }

  const overflow = send(pending, {
    type: HYPER_BRIDGE_CHUNK,
    token: TOKEN,
    id: MAX_PENDING_HYPER_BRIDGE_REQUESTS + 1,
    url: 'hyper://d/a',
    body: 'x'
  })
  assert.equal(overflow.kind, 'error')
})

test('a failed fetch comes back as an error the page can throw', () => {
  assert.deepEqual(createHyperBridgeReply({ ok: false, error: 'Drive not found' }), { error: 'Drive not found' })
  assert.deepEqual(createHyperBridgeReply(null), { error: 'hyper:// request failed' })
})

test('a successful fetch keeps its status, headers and body', () => {
  assert.deepEqual(createHyperBridgeReply({
    ok: true,
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'text/plain' },
    body: 'hyper://abc/'
  }), {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': 'text/plain' },
    body: 'hyper://abc/',
    base64: false
  })
})

test('the reply injected back into the page is one safe expression', () => {
  const script = createHyperBridgeSettleScript(TOKEN, 7, { status: 200, body: '</script>' })
  assert.match(script, /^window\.__peerskyHyperBridge && window\.__peerskyHyperBridge\.settle\(/)
  assert.ok(script.endsWith(';true;'))
  // The body is JSON, so nothing in it can close the statement early.
  assert.doesNotMatch(script, /<\/script>/)
})

test('the injected page script declares the bridge and patches fetch', () => {
  const script = createHyperBridgeScript(TOKEN)
  assert.match(script, /window\.__peerskyHyperBridge/)
  assert.match(script, /window\.fetch = async/)
  // Anything that is not hyper:// still goes to the real fetch.
  assert.match(script, /if \(!isHyper\(raw\)\) return nativeFetch\(input, init\)/)
  assert.ok(script.includes(JSON.stringify(TOKEN)))
})

// A page built on hyper commonly posts a form. The bridge refused outright,
// which made anything with an upload form unusable on the phone while the same
// page worked on desktop.
test('a form posts over hyper, with the boundary the body was written with', async () => {
  const script = createHyperBridgeScript('token')

  // The multipart document is written here because the request leaves the page
  // as base64 rather than as a body the engine sends, so nothing else can.
  assert.match(script, /body instanceof FormData\) return encodeFormData\(body\)/)
  assert.match(script, /multipart\/form-data; boundary=/)
  assert.match(script, /Content-Disposition: form-data; name="/)
  assert.match(script, /filename="/)

  // A field name cannot end its own header early.
  assert.match(script, /const quoteField = \(value\) =>/)
  assert.match(script, /replace\(\/"\/g, '%22'\)/)

  // The page's own Content-Type wins; otherwise the boundary is filled in,
  // since only the encoder knows it.
  assert.match(script, /!Object\.keys\(headers\)\.some\(\(name\) => name\.toLowerCase\(\) === 'content-type'\)/)

  // And the other shapes still carry the type they imply.
  assert.match(script, /application\/x-www-form-urlencoded;charset=UTF-8/)
})
