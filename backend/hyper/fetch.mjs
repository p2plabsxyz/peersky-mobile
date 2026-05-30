import b4a from 'b4a'
import { getHyperRuntime } from './runtime.mjs'
import { parseHyperUrl } from './url.mjs'

export async function fetchHyper ({
  url,
  method = 'GET'
} = {}) {
  if (method.toUpperCase() !== 'GET') {
    return { ok: false, error: 'Only GET is currently supported' }
  }

  const target = parseHyperUrl(url)
  if (target.error) return { ok: false, error: target.error }

  const runtime = await getHyperRuntime()
  const drive = await runtime.getDrive(target.driveAddress)

  if (target.pathname === '/' || target.pathname.endsWith('/')) {
    const files = []

    for await (const entry of drive.list(target.pathname)) {
      files.push(entry.key)
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      url,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(files, null, 2)
    }
  }

  const file = await drive.get(target.pathname)

  if (!file) {
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      url,
      headers: { 'content-type': 'text/plain' },
      body: `No file found at ${target.pathname}`
    }
  }

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: b4a.toString(file)
  }
}
