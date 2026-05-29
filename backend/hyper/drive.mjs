import b4a from 'b4a'
import { getHyperRuntime } from './runtime.mjs'

export async function createDrive ({ name } = {}) {
  const runtime = await getHyperRuntime()
  const driveName = typeof name === 'string' && name.trim()
    ? name.trim()
    : `drive-${Date.now()}`

  const drive = await runtime.getDrive(driveName)
  const indexPath = '/index.html'
  const hasIndex = await drive.exists(indexPath)

  if (!hasIndex) {
    const html = `<!doctype html>
<meta charset="utf-8" />
<title>PeerSky Mobile Hyperdrive</title>
<h1>PeerSky Mobile Hyperdrive</h1>
<p>This drive was created from the mobile Bare worklet.</p>
`
    await drive.put(indexPath, b4a.from(html))
  }

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: `hyper://${drive.id}/`
  }
}
