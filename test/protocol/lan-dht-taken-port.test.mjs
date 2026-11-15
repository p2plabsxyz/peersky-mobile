// The LAN DHT binds the one port it is given. When another program holds that
// port, PeerSky destroys it and tries another, but the one that failed kept
// watching the network interfaces after it was destroyed, and that watcher
// held the worklet, and a test run, open for good. Fixed in
// patches/dht-rpc+6.27.0.patch.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../', import.meta.url))

// In a process of its own, so what is left running shows as a process that
// does not end.
const script = `
import DHT from 'dht-rpc'
import UDX from 'udx-native'
const taken = new UDX().createSocket()
taken.bind(0, '127.0.0.1')
const lan = DHT.bootstrapper(taken.address().port, '127.0.0.1')
const ready = await lan.ready().then(() => 'ready', (error) => error.message)
const destroyed = await lan.destroy().then(() => 'destroyed', (error) => error.message)
await taken.close()
console.log(JSON.stringify({ ready, destroyed }))
`

test('a LAN DHT whose port is taken leaves nothing running once destroyed', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit']
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  const ended = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve('still running after 10s')
    }, 10_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })

  const { ready, destroyed } = JSON.parse(output)
  // It still says why it could not start, to whoever destroyed it too.
  assert.match(ready, /already in use/)
  assert.match(destroyed, /already in use/)
  assert.equal(ended, 0)
})
