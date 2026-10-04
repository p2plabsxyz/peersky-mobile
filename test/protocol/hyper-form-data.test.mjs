import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

import { parseMultipartFormData } from '../../backend/hyper/form-data.mjs'
import { createHyperBridgeScript } from '../../app/hyper-bridge.mjs'

const encoder = new TextEncoder()

function multipart (boundary, parts) {
  let text = ''
  for (const part of parts) {
    text += `--${boundary}\r\n`
    text += part.filename === undefined
      ? `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
      : `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type || 'application/octet-stream'}\r\n\r\n`
    text += `${part.value}\r\n`
  }
  return encoder.encode(`${text}--${boundary}--\r\n`)
}

async function readStream (file) {
  const chunks = []
  for await (const chunk of file.stream()) chunks.push(...chunk)
  return new TextDecoder().decode(new Uint8Array(chunks))
}

// A page publishes several files at once with a FormData PUT. hypercore-fetch
// reads it with request.formData(), which the worklet's Request lacked, so the
// upload died with "request.formData is not a function".
describe('form data from a page', () => {
  it('reads files and fields in order, the way hypercore-fetch takes them', async () => {
    const body = multipart('XyZ', [
      { name: 'file', filename: 'note.txt', type: 'text/plain', value: 'Hello\r\nthere' },
      { name: 'title', value: 'A field' },
      { name: 'file', filename: 'info.json', type: 'application/json', value: '{"a":1}' }
    ])
    const form = parseMultipartFormData(body, 'multipart/form-data; boundary=XyZ')
    const entries = [...form]
    assert.deepEqual(entries.map(([name]) => name), ['file', 'title', 'file'])
    assert.equal(entries[1][1], 'A field')
    assert.equal(entries[0][1].name, 'note.txt')
    assert.equal(entries[0][1].type, 'text/plain')
    // A line break inside a file is the file's, not the part's end.
    assert.equal(await readStream(entries[0][1]), 'Hello\r\nthere')
    assert.equal(await entries[2][1].text(), '{"a":1}')
    assert.equal(form.getAll('file').length, 2)
  })

  it('keeps a file inside the folder it was sent to', () => {
    const body = multipart('b', [{ name: 'file', filename: '../../etc/passwd', value: 'x' }])
    const [[, file]] = parseMultipartFormData(body, 'multipart/form-data; boundary="b"')
    assert.equal(file.name, 'passwd')
  })

  it('refuses a body that is not form data', () => {
    assert.throws(() => parseMultipartFormData(encoder.encode('hello'), 'multipart/form-data'), /boundary/)
    assert.throws(() => parseMultipartFormData(encoder.encode('hello'), 'multipart/form-data; boundary=zz'), /boundary/)
    assert.throws(
      () => parseMultipartFormData(encoder.encode('--zz\r\nno header end'), 'multipart/form-data; boundary=zz'),
      /closing boundary|no header/
    )
  })

  // The exact bytes a page sends: the bridge builds the multipart body itself.
  it('reads what the page bridge writes', async () => {
    let posted = null
    const window = {
      ReactNativeWebView: { postMessage: (message) => { posted = JSON.parse(message) } },
      fetch: async () => { throw new Error('not hyper') }
    }
    const context = vm.createContext({
      window,
      document: { baseURI: 'hyper://site/', addEventListener () {} },
      Blob,
      FormData,
      TextEncoder,
      Uint8Array,
      ArrayBuffer,
      URL,
      URLSearchParams,
      Response,
      TypeError,
      Map,
      JSON,
      Math,
      Date,
      Object,
      String,
      Number,
      Promise,
      btoa,
      atob
    })
    vm.runInContext(createHyperBridgeScript('t'.repeat(32)), context)
    const form = new FormData()
    form.append('file', new Blob(['Hello from the phone'], { type: 'text/plain' }), 'note.txt')
    form.append('file', new Blob(['{"from":"formdata"}'], { type: 'application/json' }), 'info.json')
    context.window.fetch('hyper://drive/', { method: 'PUT', body: form }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(posted.method, 'PUT')
    const contentType = posted.headers['Content-Type']
    const parsed = [...parseMultipartFormData(Buffer.from(posted.body, 'base64'), contentType)]
    assert.deepEqual(parsed.map(([, file]) => file.name), ['note.txt', 'info.json'])
    assert.equal(await parsed[0][1].text(), 'Hello from the phone')
    assert.equal(await parsed[1][1].text(), '{"from":"formdata"}')
  })

  it('is what the worklet\'s Request hands hypercore-fetch', async () => {
    const source = await readFile(new URL('../../backend/hyper/fetch.mjs', import.meta.url), 'utf8')
    assert.match(source, /async formData \(\) \{\s+return parseMultipartFormData\(await bodyToUint8Array\(this\.body\), this\.headers\.get\('content-type'\)\)/)
  })
})
