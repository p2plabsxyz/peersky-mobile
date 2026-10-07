/**
 * How long to wait on an attachment upload before giving up. It is a safety
 * net against a stall leaving the composer stuck busy, not a deadline, and has
 * to leave room for the largest file a room takes. A flat three minutes was
 * fine for photos and would cut off every film.
 */
export const UPLOAD_TIMEOUT_MS = 3 * 60 * 1000
// Sealing and hashing a megabyte takes a few milliseconds on a phone. This is
// far slower than that on purpose, because giving up on an upload that was
// still working is worse than waiting.
export const UPLOAD_TIMEOUT_PER_MEGABYTE_MS = 300

export function getPeerChatUploadTimeout (byteLength) {
  const megabytes = Number.isSafeInteger(byteLength) && byteLength > 0
    ? byteLength / (1024 * 1024)
    : 0
  return UPLOAD_TIMEOUT_MS + Math.round(megabytes * UPLOAD_TIMEOUT_PER_MEGABYTE_MS)
}
