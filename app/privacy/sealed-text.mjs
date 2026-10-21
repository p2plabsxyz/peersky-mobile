import { secretbox } from '@noble/ciphers/salsa'

// The app's side of backend/hyper/sealed-file.mjs: the same locked JSON, made
// with the same NaCl secretbox, so a file the app locks the backend can open
// too, as a backup does when it packs it.

const MARK = 'peersky-sealed'
const NONCE_BYTES = 24
const HEX_KEY = /^[0-9a-f]{64}$/

function hexToBytes (hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function bytesToHex (bytes) {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64 (bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? BASE64[n & 63] : '=')
  }
  return out
}

function base64ToBytes (text) {
  const clean = text.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor(clean.length * 3 / 4))
  let buffer = 0
  let bits = 0
  let index = 0
  for (const char of clean) {
    const value = BASE64.indexOf(char)
    if (value < 0) throw new Error('Not base64')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[index++] = (buffer >> bits) & 0xff
    }
  }
  return bytes
}

export function isSealedText (text) {
  try {
    const parsed = JSON.parse(text)
    return Boolean(parsed && parsed[MARK] === 1 && typeof parsed.nonce === 'string' && typeof parsed.box === 'string')
  } catch {
    return false
  }
}

/**
 * text locked with the key (64 hex characters). randomBytes gives the nonce.
 * @param {string} text
 * @param {string} keyHex
 * @param {(length: number) => Uint8Array} randomBytes
 */
export function sealText (text, keyHex, randomBytes) {
  if (!HEX_KEY.test(keyHex || '')) throw new Error('No key to lock with')
  const nonce = randomBytes(NONCE_BYTES)
  const box = secretbox(hexToBytes(keyHex), nonce).seal(new TextEncoder().encode(text))
  return JSON.stringify({ [MARK]: 1, nonce: bytesToHex(nonce), box: bytesToBase64(box) })
}

/**
 * The text inside a locked file, or the text itself when it is not locked.
 * Throws when it is locked and the key does not open it.
 * @param {string} text
 * @param {string | null} keyHex
 * @returns {{ text: string, sealed: boolean }}
 */
export function openText (text, keyHex) {
  if (!isSealedText(text)) return { text, sealed: false }
  if (!HEX_KEY.test(keyHex || '')) throw new Error('Locked, and no key to open it')
  const parsed = JSON.parse(text)
  const opened = secretbox(hexToBytes(keyHex), hexToBytes(parsed.nonce)).open(base64ToBytes(parsed.box))
  if (!opened) throw new Error('Locked with another key')
  return { text: new TextDecoder().decode(opened), sealed: true }
}
