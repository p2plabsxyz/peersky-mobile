import b4a from 'b4a'

// A page publishes several files at once with FormData: PUT to a folder, one
// "file" field per file (docs/P2P.md in PeerSky Desktop). hypercore-fetch reads
// those with request.formData(), and the worklet's Request had none, so every
// such upload failed with "request.formData is not a function".

const CRLF = b4a.from('\r\n')
const HEADER_END = b4a.from('\r\n\r\n')
// A part's own headers are a few short lines. Anything longer is not a part.
const MAX_PART_HEADER_BYTES = 16 * 1024

/**
 * The fields of a multipart/form-data body, in order, as [name, value] pairs.
 * A text field is a string. A file has the name the page gave it, its type,
 * and stream() for hypercore-fetch to write from.
 */
export function parseMultipartFormData (body, contentType) {
  const boundary = readBoundary(contentType)
  if (!boundary) throw new TypeError('Form data has no boundary')

  const bytes = body instanceof Uint8Array ? body : b4a.from(body || '')
  const delimiter = b4a.from(`--${boundary}`)
  const entries = []

  let start = b4a.indexOf(bytes, delimiter, 0)
  if (start === -1) throw new TypeError('Form data does not start with its boundary')

  while (start !== -1) {
    let partStart = start + delimiter.byteLength
    // "--" right after a delimiter closes the body.
    if (bytes[partStart] === 0x2d && bytes[partStart + 1] === 0x2d) break
    if (startsWith(bytes, CRLF, partStart)) partStart += CRLF.byteLength

    const next = b4a.indexOf(bytes, delimiter, partStart)
    if (next === -1) throw new TypeError('Form data ends before its closing boundary')

    // The part's content runs up to the line break before the next delimiter.
    const partEnd = startsWith(bytes, CRLF, next - CRLF.byteLength) ? next - CRLF.byteLength : next
    const headerEnd = b4a.indexOf(bytes, HEADER_END, partStart)
    if (headerEnd === -1 || headerEnd > partEnd || headerEnd - partStart > MAX_PART_HEADER_BYTES) {
      throw new TypeError('A form part has no header')
    }

    const headers = readPartHeaders(b4a.toString(bytes.subarray(partStart, headerEnd)))
    const content = bytes.subarray(headerEnd + HEADER_END.byteLength, partEnd)
    const disposition = headers['content-disposition'] || ''
    const name = readDispositionValue(disposition, 'name')
    if (name !== null) {
      const filename = readDispositionValue(disposition, 'filename')
      entries.push([
        name,
        filename === null
          ? b4a.toString(content)
          : createFormFile(content, filename, headers['content-type'])
      ])
    }

    start = next
  }

  return new FormEntries(entries)
}

class FormEntries {
  constructor (entries) {
    this.list = entries
  }

  [Symbol.iterator] () {
    return this.list[Symbol.iterator]()
  }

  entries () {
    return this.list[Symbol.iterator]()
  }

  get (name) {
    const entry = this.list.find(([key]) => key === name)
    return entry ? entry[1] : null
  }

  getAll (name) {
    return this.list.filter(([key]) => key === name).map(([, value]) => value)
  }
}

function createFormFile (content, filename, type) {
  // Copied out, so the file does not hold on to the whole request body.
  const bytes = b4a.from(content)
  return {
    // The name only: a page's "../" or a Windows path would otherwise choose
    // where in the drive the file lands.
    name: filename.split(/[\\/]/).pop() || 'file',
    type: type || 'application/octet-stream',
    size: bytes.byteLength,
    stream: () => (async function * () { yield bytes })(),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    text: async () => b4a.toString(bytes)
  }
}

function readBoundary (contentType) {
  const match = /boundary=(?:"([^"]{1,200})"|([^;\s]{1,200}))/i.exec(String(contentType || ''))
  return match ? (match[1] || match[2]) : null
}

function readPartHeaders (text) {
  const headers = {}
  for (const line of text.split('\r\n')) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
  }
  return headers
}

// name="..." or filename="...", quoted as browsers write them. A quote inside
// a value arrives as %22 (the page bridge writes it that way too).
function readDispositionValue (disposition, key) {
  const match = new RegExp(`(?:^|;)\\s*${key}="([^"]*)"`, 'i').exec(disposition)
  if (!match) return null
  return match[1].replace(/%22/g, '"')
}

function startsWith (bytes, prefix, offset) {
  if (offset < 0 || offset + prefix.byteLength > bytes.byteLength) return false
  for (let index = 0; index < prefix.byteLength; index += 1) {
    if (bytes[offset + index] !== prefix[index]) return false
  }
  return true
}
