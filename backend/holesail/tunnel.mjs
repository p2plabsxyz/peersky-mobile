import HyperDHT from 'hyperdht'
import net from 'net'
import { createHash, randomBytes } from 'node:crypto'
import b4a from 'b4a'
import z32 from 'z32'

// P2PMD notes travel over Holesail's protocol, which the desktop speaks
// through the Holesail package. That package is AGPL, which cannot ship in an
// App Store app, so the phone speaks the same protocol through this file,
// written for PeerSky on hyperdht (MIT).
//
// What both ends agree on:
// - A note address is hs://, four flag characters, then the key. A first flag
//   of "s" means private.
// - Private: the host and everyone joining make the same key pair from the
//   sha256 of the key, and the host lets in only connections made with that
//   key pair, so only someone who has the address gets in.
// - Public: the key is the host's public key in z32, and the host makes its
//   key pair from the sha256 of a seed only it keeps.
// - The host keeps a signed record under its public key saying where its
//   local server listens, as JSON { host, udp, port }.
// - Each connection carries the bytes of one TCP connection to that server.

const PRIVATE_FLAGS = 's000'
const PUBLIC_FLAGS = '0000'
const DEFAULT_PORT = 8989
const LOOPBACK = '127.0.0.1'
// Records on the DHT expire, so the host puts its record back this often.
const RECORD_REFRESH_MS = 50 * 60 * 1000

/** The key in a note address and whether the address says it is private. */
export function parseNoteAddress (address) {
  const text = String(address || '').trim()
  if (text.startsWith('hs://') && text.length > 9) {
    return { key: text.slice(9), secure: text[5] === 's' }
  }
  return { key: text, secure: undefined }
}

export function noteAddress (key, secure) {
  return 'hs://' + (secure ? PRIVATE_FLAGS : PUBLIC_FLAGS) + key
}

function keyPairFor (key) {
  return HyperDHT.keyPair(createHash('sha256').update(String(key)).digest())
}

// Tests pass a bootstrap list for a local test network. The app never does.
function createDht ({ keyPair, bootstrap } = {}) {
  const opts = {}
  if (keyPair) opts.keyPair = keyPair
  if (bootstrap) opts.bootstrap = bootstrap
  return new HyperDHT(opts)
}

/** Hosts a local TCP server under a note address. */
export class TunnelHost {
  constructor ({ key, secure = true, host = LOOPBACK, port = DEFAULT_PORT, bootstrap } = {}) {
    const parsed = parseNoteAddress(key)
    this.secure = parsed.secure ?? Boolean(secure)
    this.host = host
    this.port = port
    this.bootstrap = bootstrap
    // A private note with no key yet gets a new one. A public note always
    // comes with its seed from the caller, or it could never be hosted again.
    this.key = parsed.key || (this.secure ? b4a.toString(randomBytes(32), 'hex') : null)
    this.keyPair = this.key ? keyPairFor(this.key) : HyperDHT.keyPair(randomBytes(32))
    this.state = 'closed'
    this.dht = null
    this.server = null
    this.refresh = null
    this.sockets = new Set()
  }

  get publicKey () {
    return z32.encode(this.keyPair.publicKey)
  }

  async open () {
    this.dht = createDht({ bootstrap: this.bootstrap })
    const ownKey = this.keyPair.publicKey
    this.server = this.dht.createServer({
      // Only someone holding the same key pair, that is the address, gets in.
      firewall: this.secure ? (remotePublicKey) => !b4a.equals(remotePublicKey, ownKey) : undefined,
      reusableSocket: true
    }, (remote) => {
      const local = net.connect({ port: this.port, host: this.host, allowHalfOpen: true })
      bridge(local, remote, this.sockets)
    })

    this.state = 'opening'
    // Announcing waits on the network. Joiners find the host once it lands,
    // so opening does not wait for it.
    this.server.listen(this.keyPair).then(() => {
      if (this.state === 'opening') this.state = 'listening'
    }, (error) => {
      console.error('[holesail] Unable to announce the note:', error?.message || error)
    })

    const record = JSON.stringify({ host: this.host, udp: false, port: this.port })
    await putRecord(this.dht, this.keyPair, record)
    this.refresh = setInterval(() => {
      putRecord(this.dht, this.keyPair, record).catch((error) => {
        console.error('[holesail] Unable to refresh the note record:', error?.message || error)
      })
    }, RECORD_REFRESH_MS)
    if (typeof this.refresh?.unref === 'function') this.refresh.unref()
  }

  get info () {
    const key = this.secure ? this.key : this.publicKey
    return {
      type: 'server',
      state: this.state,
      secure: this.secure,
      port: this.port,
      host: this.host,
      protocol: 'tcp',
      key,
      url: noteAddress(key, this.secure),
      publicKey: this.publicKey
    }
  }

  async close () {
    this.state = 'closed'
    if (this.refresh) clearInterval(this.refresh)
    this.refresh = null
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const dht = this.dht
    this.dht = null
    this.server = null
    if (dht) await dht.destroy()
  }
}

/** Listens on a local port and carries each connection to a note's host. */
export class TunnelGuest {
  constructor ({ key, secure, host = LOOPBACK, port, bootstrap } = {}) {
    const parsed = parseNoteAddress(key)
    this.secure = parsed.secure ?? Boolean(secure)
    this.key = parsed.key
    this.host = host
    this.port = port
    this.bootstrap = bootstrap
    this.state = 'closed'
    this.dht = null
    this.proxy = null
    this.sockets = new Set()
    if (this.secure) {
      this.keyPair = keyPairFor(this.key)
      this.remotePublicKey = this.keyPair.publicKey
    } else {
      this.keyPair = null
      this.remotePublicKey = z32.decode(this.key)
      if (this.remotePublicKey.byteLength !== 32) throw new Error('Invalid note key')
    }
  }

  get publicKey () {
    return z32.encode(this.remotePublicKey)
  }

  async open () {
    this.dht = createDht({ keyPair: this.keyPair, bootstrap: this.bootstrap })
    this.state = 'waiting'

    // With no port asked for, use the one the host's server is on, as the
    // desktop does, so a note's local address is the same on every device.
    let advertised = {}
    try {
      const record = await this.dht.mutableGet(this.remotePublicKey, { latest: true })
      if (record?.value) advertised = JSON.parse(b4a.toString(record.value))
    } catch {}
    if (advertised?.udp === true) {
      throw Object.assign(new Error('This note is shared over UDP, which PeerSky cannot join.'), { code: 'UDP_NOTE' })
    }
    const advertisedPort = Number.isInteger(advertised?.port) && advertised.port > 0 && advertised.port < 65536
      ? advertised.port
      : null
    const port = this.port ?? advertisedPort ?? DEFAULT_PORT

    const proxy = net.createServer({ allowHalfOpen: true }, (local) => {
      const remote = this.dht.connect(this.remotePublicKey, { reusableSocket: true })
      bridge(local, remote, this.sockets)
    })
    this.proxy = proxy
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        proxy.off('listening', onListening)
        reject(Object.assign(error, { port }))
      }
      const onListening = () => {
        proxy.off('error', onError)
        resolve()
      }
      proxy.once('error', onError)
      proxy.once('listening', onListening)
      proxy.listen(port, this.host)
    })
    // A later error on the listening socket is logged, never thrown.
    proxy.on('error', (error) => {
      console.error('[holesail] Local proxy error:', error?.message || error)
    })
    this.port = proxy.address()?.port || port
    this.state = 'listening'
  }

  get info () {
    return {
      type: 'client',
      state: this.state,
      secure: this.secure,
      port: this.port,
      host: this.host,
      protocol: 'tcp',
      key: this.key,
      url: noteAddress(this.key, this.secure),
      publicKey: this.publicKey
    }
  }

  async close () {
    this.state = 'closed'
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const proxy = this.proxy
    this.proxy = null
    if (proxy) {
      await new Promise((resolve) => {
        try {
          proxy.close(() => resolve())
        } catch {
          resolve()
        }
      })
    }
    const dht = this.dht
    this.dht = null
    if (dht) await dht.destroy()
  }
}

// Puts the host's record, reusing the last sequence number when nothing
// changed and going one past it when something did, as a signed record has to.
async function putRecord (dht, keyPair, value) {
  const data = b4a.from(value)
  const latest = await dht.mutableGet(keyPair.publicKey, { latest: true })
  let seq = 0
  if (latest) {
    seq = latest.value && b4a.equals(b4a.from(latest.value), data) ? latest.seq : latest.seq + 1
  }
  await dht.mutablePut(keyPair, data, { seq })
}

// Carries bytes both ways until either end closes, and closes the other with
// it. A half close (end) is passed on, so a request can finish while its
// answer is still on the way. That needs both local sockets opened with
// allowHalfOpen, as Holesail opens them; otherwise a socket closes its own
// side as soon as the other does, and the answer is lost.
function bridge (local, remote, sockets) {
  sockets.add(local)
  sockets.add(remote)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    sockets.delete(local)
    sockets.delete(remote)
    local.destroy()
    remote.destroy()
  }
  for (const [from, to] of [[local, remote], [remote, local]]) {
    let waiting = false
    from.on('data', (data) => {
      if (to.write(data) !== false || waiting) return
      waiting = true
      from.pause()
      to.once('drain', () => {
        waiting = false
        from.resume()
      })
    })
    from.on('end', () => to.end())
    from.on('error', close)
    from.on('close', close)
  }
}
