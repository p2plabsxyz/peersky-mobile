import b4a from 'b4a'
import { MAX_BACKUP_SIZE_BYTES } from '../backup/limits.mjs'

export async function readHyperBinaryResponse (
  response,
  headers,
  url,
  maxBytes = MAX_BACKUP_SIZE_BYTES
) {
  const contentLength = Number(headers['content-length'] || 0)
  if (contentLength > maxBytes) {
    throw new Error(`Response exceeds ${maxBytes} byte limit: ${contentLength} bytes`)
  }

  const chunks = []
  let totalLength = 0
  const appendChunk = (chunk) => {
    const bytes = toBytes(chunk)
    totalLength += bytes.byteLength
    if (totalLength > maxBytes) {
      throw new Error(`Response exceeds ${maxBytes} byte limit`)
    }
    chunks.push(bytes)
  }
  const body = response.body

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        appendChunk(value)
      }
    } catch (error) {
      try { await reader.cancel() } catch {}
      throw error
    } finally {
      if (reader.releaseLock) reader.releaseLock()
    }
  } else if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) appendChunk(chunk)
  } else {
    appendChunk(await response.arrayBuffer())
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url || url,
    headers,
    bytes: b4a.concat(chunks)
  }
}

function toBytes (chunk) {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  return b4a.from(String(chunk))
}
