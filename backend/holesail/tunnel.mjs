import HyperDHT from 'hyperdht'
import net from 'net'
import { createHash, randomBytes } from 'node:crypto'
import b4a from 'b4a'
import z32 from 'z32'
import { findNoteRouteOnLan, hostNoteOnLan } from './lan.mjs'
import { FORBIDDEN_RESPONSE, createRequestGate, createRequestStamp } from './request-gate.mjs'

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
//
// Given a token, both ends also keep other apps on the phone out of the note
// (request-gate.mjs). The token never crosses the wire, so what the other end
// sees is unchanged.
//
// Given the LAN DHT, the host is on the local network too and a guest looks
// there first, so a note opens over Wi-Fi with no internet (lan.mjs).

const PRIVATE_FLAGS = 's000'
const PUBLIC_FLAGS = '0000'
const DEFAULT_PORT = 8989
const LOOPBACK = '127.0.0.1'
// Records on the DHT expire, so the host puts its record back this often.
const RECORD_REFRESH_MS = 50 * 60 * 1000
// With no internet the record cannot be put, and the note is on the local
// network only. It is tried again this often until the internet answers.
const RECORD_RETRY_MS = 60 * 1000
// How long a host on the local network waits for its record before going on
// without it.
const INTERNET_SETTLE_MS = 3000

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
  constructor ({ key, secure = true, host = LOOPBACK, port = DEFAULT_PORT, token = null, bootstrap, lan = null, settleMs = INTERNET_SETTLE_MS } = {}) {
    const parsed = parseNoteAddress(key)
    this.secure = parsed.secure ?? Boolean(secure)
    this.host = host
    this.port = port
    // The local server's token. It goes on the requests of whoever came in
    // with the note's address, which is how the server tells them from
    // another app on this phone that found its port.
    this.token = token
    this.bootstrap = bootstrap
    // A private note with no key yet gets a new one. A public note always
    // comes with its seed from the caller, or it could never be hosted again.
    this.key = parsed.key || (this.secure ? b4a.toString(randomBytes(32), 'hex') : null)
    this.keyPair = this.key ? keyPairFor(this.key) : HyperDHT.keyPair(randomBytes(32))
    this.state = 'closed'
    this.dht = null
    this.server = null
    this.refresh = null
    this.retry = null
    this.sockets = new Set()
    this.lan = lan
    this.lanHost = null
    this.settleMs = settleMs
    // Whether the host's record is on the internet DHT, so joiners there find it.
    this.internet = false
  }

  get publicKey () {
    return z32.encode(this.keyPair.publicKey)
  }

  async open () {
    this.dht = createDht({ bootstrap: this.bootstrap })
    const ownKey = this.keyPair.publicKey
    const serve = (remote) => {
      const local = net.connect({ port: this.port, host: this.host, allowHalfOpen: true })
      bridge(local, remote, this.sockets, this.token ? { toLocal: createRequestStamp(this.token) } : {})
    }
    this.server = this.dht.createServer({
      // Only someone holding the same key pair, that is the address, gets in.
      firewall: this.secure ? (remotePublicKey) => !b4a.equals(remotePublicKey, ownKey) : undefined,
      reusableSocket: true
    }, serve)

    this.state = 'opening'
    // Announcing waits on the network. Joiners find the host once it lands,
    // so opening does not wait for it.
    this.server.listen(this.keyPair).then(() => {
      if (this.state === 'opening') this.state = 'listening'
    }, (error) => {
      console.error('[holesail] Unable to announce the note:', error?.message || error)
    })

    if (this.lan) {
      this.lanHost = await hostNoteOnLan(this.lan, { keyPair: this.keyPair, secure: this.secure, onConnection: serve })
        .catch((error) => {
          console.warn('[holesail] Unable to host the note on the local network:', error?.message || error)
          return null
        })
    }

    const record = JSON.stringify({ host: this.host, udp: false, port: this.port })
    const put = putRecord(this.dht, this.keyPair, record)
    if (!this.lanHost) {
      await put
      this.keepRecord(record)
      return
    }
    // On the local network already: with no internet, putting the record
    // fails after a while, and the note goes on there alone.
    put.then(() => this.keepRecord(record), (error) => {
      if (this.state === 'closed') return
      console.warn('[holesail] Hosting the note on the local network until the internet answers:', error?.message || error)
      this.retryRecord(record)
    })
    let timer = null
    await Promise.race([
      put.catch(() => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, this.settleMs) })
    ])
    clearTimeout(timer)
  }

  keepRecord (record) {
    if (this.state === 'closed' || this.refresh) return
    this.internet = true
    this.refresh = setInterval(() => {
      putRecord(this.dht, this.keyPair, record).catch((error) => {
        console.error('[holesail] Unable to refresh the note record:', error?.message || error)
      })
    }, RECORD_REFRESH_MS)
    if (typeof this.refresh?.unref === 'function') this.refresh.unref()
  }

  retryRecord (record) {
    if (this.state === 'closed' || this.retry) return
    let trying = false
    this.retry = setInterval(async () => {
      if (trying || !this.dht) return
      trying = true
      try {
        await putRecord(this.dht, this.keyPair, record)
        clearInterval(this.retry)
        this.retry = null
        this.keepRecord(record)
      } catch {
      } finally {
        trying = false
      }
    }, RECORD_RETRY_MS)
    if (typeof this.retry?.unref === 'function') this.retry.unref()
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
      publicKey: this.publicKey,
      lan: Boolean(this.lanHost),
      internet: this.internet
    }
  }

  async close () {
    this.state = 'closed'
    if (this.refresh) clearInterval(this.refresh)
    this.refresh = null
    if (this.retry) clearInterval(this.retry)
    this.retry = null
    const lanHost = this.lanHost
    this.lanHost = null
    if (lanHost) await lanHost.close()
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
  constructor ({ key, secure, host = LOOPBACK, port, token = null, bootstrap, lan = null } = {}) {
    const parsed = parseNoteAddress(key)
    this.secure = parsed.secure ?? Boolean(secure)
    this.key = parsed.key
    this.host = host
    this.port = port
    // This phone's editor puts the token on each request it makes here. A
    // connection from another app on the phone never reaches the host.
    this.token = token
    this.bootstrap = bootstrap
    this.state = 'closed'
    this.dht = null
    this.proxy = null
    this.sockets = new Set()
    this.lan = lan
    // Set when the host was found on the local network and is reached there.
    this.lanRoute = null
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
    this.state = 'waiting'
    if (this.lan) {
      this.lanRoute = await findNoteRouteOnLan(this.lan, { publicKey: this.remotePublicKey, keyPair: this.keyPair })
        .catch(() => null)
    }

    // With no port asked for, use the one the host's server is on, as the
    // desktop does, so a note's local address is the same on every device.
    // Found on the local network, the host's record may be out of reach, and
    // the port asked for, or the usual one, is used.
    let advertised = {}
    let connect
    if (this.lanRoute) {
      const route = this.lanRoute
      connect = () => this.proxy ? route.connect() : null
    } else {
      this.dht = createDht({ keyPair: this.keyPair, bootstrap: this.bootstrap })
      try {
        const record = await this.dht.mutableGet(this.remotePublicKey, { latest: true })
        if (record?.value) advertised = JSON.parse(b4a.toString(record.value))
      } catch {}
      if (advertised?.udp === true) {
        throw Object.assign(new Error('This note is shared over UDP, which PeerSky cannot join.'), { code: 'UDP_NOTE' })
      }
      connect = () => this.dht ? this.dht.connect(this.remotePublicKey, { reusableSocket: true }) : null
    }
    const advertisedPort = Number.isInteger(advertised?.port) && advertised.port > 0 && advertised.port < 65536
      ? advertised.port
      : null
    const port = this.port ?? advertisedPort ?? DEFAULT_PORT

    const proxy = net.createServer({ allowHalfOpen: true }, (local) => {
      if (!this.token) {
        const remote = connect()
        if (!remote) return local.destroy()
        bridge(local, remote, this.sockets)
        return
      }
      // The host is called only once a request has shown the token, and the
      // tunnel may have closed by then.
      admit(local, createRequestGate(this.token), connect, this.sockets)
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
      publicKey: this.publicKey,
      lan: Boolean(this.lanRoute)
    }
  }

  async close () {
    this.state = 'closed'
    this.lanRoute = null
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

// Holds a joined note's local connection until its first request shows the
// token, and only then reaches the host. One that does not is answered here,
// so another app on the phone cannot even make this phone call the host.
function admit (local, gate, connect, sockets) {
  sockets.add(local)
  const forget = () => sockets.delete(local)
  const drop = () => {
    forget()
    local.destroy()
  }
  const onData = (data) => {
    const first = gate.push(data)
    if (first !== null && !first.byteLength) return
    local.off('data', onData)
    local.off('end', drop)
    if (first === null) {
      // Answered and closed. Anything else it sends goes nowhere.
      local.once('finish', drop)
      local.end(b4a.from(FORBIDDEN_RESPONSE))
      return
    }

    const remote = connect()
    if (!remote) return drop()
    local.off('error', drop)
    local.off('close', forget)
    bridge(local, remote, sockets, { toRemote: gate.push })
    remote.write(first)
  }
  local.on('data', onData)
  local.on('end', drop)
  local.on('error', drop)
  local.on('close', forget)
}

// Carries bytes both ways until either end closes, and closes the other with
// it. A half close (end) is passed on, so a request can finish while its
// answer is still on the way. That needs both local sockets opened with
// allowHalfOpen, as Holesail opens them; otherwise a socket closes its own
// side as soon as the other does, and the answer is lost.
// toRemote and toLocal change what goes each way: null from one closes both.
function bridge (local, remote, sockets, { toRemote = null, toLocal = null } = {}) {
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
  for (const [from, to, change] of [[local, remote, toRemote], [remote, local, toLocal]]) {
    let waiting = false
    from.on('data', (data) => {
      if (change) data = change(data)
      if (data === null) return close()
      if (!data.byteLength || to.write(data) !== false || waiting) return
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
