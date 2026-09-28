import {
  HYPER_BRIDGE_CHUNK,
  HYPER_BRIDGE_MAX_BODY_CHARACTERS,
  HYPER_BRIDGE_REQUEST
} from './hyper-bridge.mjs'

// How many part-sent uploads one tab may have in flight. A page that starts
// requests and never finishes them should not be able to grow this without
// bound.
export const MAX_PENDING_HYPER_BRIDGE_REQUESTS = 8

/**
 * Reads one message from a hyper:// page's patched fetch.
 *
 * Bodies arrive in pieces, so a message is either another piece or the last
 * one. Only the last carries the request out to the backend.
 *
 * @returns {{ kind: 'ignore' }
 *   | { kind: 'buffered' }
 *   | { kind: 'error', id: number, error: string }
 *   | { kind: 'request', id: number, url: string, method: string, headers: object, body: string }}
 */
export function readHyperBridgeMessage (raw, { token, pending }) {
  let message
  try {
    message = JSON.parse(String(raw))
  } catch {
    return { kind: 'ignore' }
  }

  const type = message?.type
  if (type !== HYPER_BRIDGE_REQUEST && type !== HYPER_BRIDGE_CHUNK) return { kind: 'ignore' }
  // The page was handed this token when it loaded. Anything else is not our
  // bridge talking.
  if (message.token !== token) return { kind: 'ignore' }

  const id = Number(message.id)
  if (!Number.isSafeInteger(id) || id < 1) return { kind: 'ignore' }

  const url = String(message.url || '')
  if (!url.toLowerCase().startsWith('hyper://')) {
    pending.delete(id)
    return { kind: 'error', id, error: 'Only hyper:// requests travel over this bridge' }
  }

  const buffered = pending.get(id) || ''
  const body = buffered + String(message.body || '')
  if (body.length > HYPER_BRIDGE_MAX_BODY_CHARACTERS) {
    pending.delete(id)
    return { kind: 'error', id, error: 'That file is too large to send over hyper:// from the phone' }
  }

  if (type === HYPER_BRIDGE_CHUNK) {
    if (!pending.has(id) && pending.size >= MAX_PENDING_HYPER_BRIDGE_REQUESTS) {
      return { kind: 'error', id, error: 'Too many uploads at once' }
    }
    pending.set(id, body)
    return { kind: 'buffered' }
  }

  pending.delete(id)
  return {
    kind: 'request',
    id,
    url,
    method: String(message.method || 'GET').toUpperCase(),
    headers: message.headers && typeof message.headers === 'object' ? message.headers : {},
    body
  }
}

/**
 * Turns a backend hyper fetch reply into what the page's Response is built
 * from. A body that is not text crosses back as base64.
 */
export function createHyperBridgeReply (response) {
  if (!response || response.ok === false) {
    return { error: String(response?.error || 'hyper:// request failed') }
  }

  return {
    status: Number.isSafeInteger(response.status) ? response.status : 200,
    statusText: String(response.statusText || ''),
    headers: response.headers && typeof response.headers === 'object' ? response.headers : {},
    body: String(response.body ?? ''),
    base64: response.base64 === true
  }
}

/** The one line injected back into the page to settle a pending request. */
export function createHyperBridgeSettleScript (token, id, reply) {
  const payload = serializeForScript(reply)
  const scopedToken = serializeForScript(String(token))
  return `window.__peerskyHyperBridge && window.__peerskyHyperBridge.settle(${scopedToken}, ${Number(id)}, ${payload});true;`
}

// JSON leaves "<" alone, so a body containing "</script>" would survive intact.
// This is injected rather than embedded in HTML today, but the escape costs
// nothing and stops the value from ever being able to close a tag.
function serializeForScript (value) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
