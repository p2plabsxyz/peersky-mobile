import b4a from 'b4a'
import { LOOPBACK_TOKEN_HEADER, isLoopbackToken } from '../loopback-request.mjs'

// A note's tunnel carries HTTP to the room's server. Both of its ends sit on
// 127.0.0.1, where any app on the phone can reach them, so both deal in the
// room's token:
// - A joined note's local port lets through only requests that carry this
//   phone's token in their address, and takes it out on the way, so the host
//   never sees it.
// - A hosted note's tunnel puts the server's token on the first request of
//   each connection from someone who came in with the note's address.

// Larger than any request the editor sends, and what Bare's HTTP parser
// allows for a request's headers.
const MAX_HEAD_BYTES = 16 * 1024
const HEAD_END = b4a.from('\r\n\r\n')
const LINE_END = b4a.from('\n')
const EMPTY = b4a.alloc(0)

// Printable ASCII only: a browser encodes everything else in an address.
const REQUEST_LINE = /^([A-Z]+) (\/[\x21-\x7e]*) (HTTP\/1\.[01])$/
const HEADER_LINE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+:[\t\x20-\x7e\x80-\xff]*$/

export const FORBIDDEN_RESPONSE = b4a.from(
  'HTTP/1.1 403 Forbidden\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  'Content-Length: 9\r\n' +
  'Cache-Control: no-store\r\n' +
  'Connection: close\r\n\r\n' +
  'Forbidden'
)

/**
 * Reads requests off a joined note's local connection, one at a time: a head,
 * then as much body as its Content-Length says. push(chunk) gives the bytes to
 * send on, which may be none yet, or null when the connection is to be
 * dropped: a request without the token, or one the editor would never send.
 */
export function createRequestGate (token) {
  let pending = EMPTY
  let bodyLeft = 0

  function push (chunk) {
    let data = pending.byteLength ? b4a.concat([pending, chunk]) : chunk
    pending = EMPTY
    const out = []

    while (data.byteLength) {
      if (bodyLeft > 0) {
        const body = data.subarray(0, bodyLeft)
        out.push(body)
        bodyLeft -= body.byteLength
        data = data.subarray(body.byteLength)
        continue
      }

      const end = b4a.indexOf(data, HEAD_END)
      if (end === -1) {
        if (data.byteLength > MAX_HEAD_BYTES) return null
        pending = b4a.from(data)
        break
      }
      const headLength = end + HEAD_END.byteLength
      if (headLength > MAX_HEAD_BYTES) return null

      const head = admitHead(b4a.toString(data.subarray(0, headLength), 'latin1'), token)
      if (!head) return null
      out.push(b4a.from(head.text, 'latin1'))
      bodyLeft = head.bodyLength
      data = data.subarray(headLength)
    }

    return out.length === 1 ? out[0] : b4a.concat(out)
  }

  return { push }
}

/**
 * Puts the server's token on the first request of a hosted note's
 * connection, as a header right after its request line. stamp(chunk) gives
 * the bytes to pass on, none while that line is still coming, or null when it
 * never ends.
 */
export function createRequestStamp (token) {
  const header = b4a.from(`${LOOPBACK_TOKEN_HEADER}: ${token}\r\n`)
  let pending = EMPTY
  let stamped = false

  return function stamp (chunk) {
    if (stamped) return chunk
    const data = pending.byteLength ? b4a.concat([pending, chunk]) : chunk
    const end = b4a.indexOf(data, LINE_END)
    if (end === -1) {
      if (data.byteLength > MAX_HEAD_BYTES) return null
      pending = b4a.from(data)
      return EMPTY
    }

    stamped = true
    pending = EMPTY
    return b4a.concat([data.subarray(0, end + 1), header, data.subarray(end + 1)])
  }
}

// One request's head with the token taken out of its address, and how long
// its body is. Null for anything else: no token or the wrong one, a body in
// chunks, a switch to another protocol, or a head that does not parse.
function admitHead (text, token) {
  const lines = text.slice(0, -HEAD_END.byteLength).split('\r\n')
  const request = REQUEST_LINE.exec(lines[0])
  if (!request) return null
  const target = withoutToken(request[2], token)
  if (target === null) return null

  let bodyLength = null
  for (const line of lines.slice(1)) {
    if (!HEADER_LINE.test(line)) return null
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (name === 'transfer-encoding' || name === 'upgrade') return null
    if (name === 'content-length') {
      if (bodyLength !== null || !/^\d{1,15}$/.test(value)) return null
      bodyLength = Number(value)
    }
  }

  lines[0] = `${request[1]} ${target} ${request[3]}`
  return { text: `${lines.join('\r\n')}\r\n\r\n`, bodyLength: bodyLength || 0 }
}

// The address without its token, or null unless it has exactly one, and the
// right one.
function withoutToken (target, token) {
  const query = target.indexOf('?')
  if (query === -1) return null

  const kept = []
  let tokens = 0
  let valid = false
  for (const part of target.slice(query + 1).split('&')) {
    if (part.split('=', 1)[0] !== 'token') {
      kept.push(part)
      continue
    }
    tokens++
    valid = isLoopbackToken(part.slice('token='.length), token)
  }
  if (tokens !== 1 || !valid) return null

  const path = target.slice(0, query)
  return kept.length ? `${path}?${kept.join('&')}` : path
}
