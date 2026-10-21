import { createHash } from 'node:crypto'
import b4a from 'b4a'
import HyperDHT from 'hyperdht'

// P2PMD notes over the local network, with no internet. A note's host is found
// on the public HyperDHT, which lives on the internet, so with the router's
// cable out a note did not open even with both devices on the same Wi-Fi, and
// could not even be hosted: putting the host's record never finished. The host
// now also listens on the LAN DHT that hyperdht-mdns runs (the one Hyperdrive
// and PeerChat already find each other on over Wi-Fi), under the note's own
// key pair, and says over mDNS that it has a topic made from the note's key.
// A device joining looks there first. Found, it opens the same Noise-encrypted
// connection it opens over the internet, straight to the host's Wi-Fi address.
// Nobody who does not know the note's key can work out the topic, and in a
// private note the host still lets in only the key the address carries. The
// desktop does the same (p2pmd-lan.js there), with the same topic, so a phone
// and a desktop find each other too.

// How long a join looks on the local network before going to the internet.
export const LAN_FIND_MS = 2500
// No other PeerSky seen on this network yet: a short look, in case one is only
// now being found, rather than the full wait on every join.
export const LAN_FIND_QUICK_MS = 800
// How long a join waits for the host found there to answer.
export const LAN_REACH_MS = 3000

export function noteTopic (publicKey) {
  return createHash('sha256').update('peersky-p2pmd-lan/1').update(publicKey).digest()
}

// How long a join waits for the host to say which port it keeps the note on.
export const LAN_PORT_MS = 1500

// A tunnel on the local network says it is alive this often, and is dropped
// after this long with nothing from the other end. A local network instance
// can go outright, after a network change or when the app's stores close for
// a backup, and the other end of each of its tunnels was never told: they
// stayed open with nothing behind them. One that has not opened in time is
// dropped too: a tunnel to a host that was away could wait for its handshake
// forever, and the editor's event stream was one of those, so the note never
// reconnected when its host came back. As on the desktop (p2pmd-lan.js).
export const LAN_KEEP_ALIVE_MS = 5000
export const LAN_STREAM_TIMEOUT_MS = 15000
export const LAN_OPEN_MS = 8000

function keepTunnelAlive (socket) {
  socket.setKeepAlive?.(LAN_KEEP_ALIVE_MS)
  socket.setTimeout?.(LAN_STREAM_TIMEOUT_MS)
  return socket
}

function openWithin (socket, ms) {
  const timer = setTimeout(() => socket.destroy(new Error('The note did not answer on the local network')), ms)
  timer.unref?.()
  socket.once('open', () => clearTimeout(timer))
  socket.once('close', () => clearTimeout(timer))
  return socket
}

/**
 * The key pair a host answers "which port?" under on the LAN DHT. Over the
 * internet a joiner reads the port from the host's record and listens on the
 * same one, so a note has one address on every device; on the local network
 * there is no record. Worked out from the note's public key, as the desktop
 * does (p2pmd-lan.js there), so the two ask each other too.
 */
export function notePortKeyPair (publicKey) {
  return HyperDHT.keyPair(createHash('sha256').update('peersky-p2pmd-lan-port/1').update(publicKey).digest())
}

function usable (lan) {
  return Boolean(lan?.dht) && !lan.destroyed
}

/**
 * The host: the note served on the LAN DHT too, each connection handed to
 * onConnection as the internet ones are, and its topic said over mDNS.
 */
export async function hostNoteOnLan (lan, { keyPair, secure, port = null, onConnection }) {
  if (!usable(lan) || !keyPair) return null
  const firewall = secure ? (remotePublicKey) => !b4a.equals(remotePublicKey, keyPair.publicKey) : undefined
  const server = lan.dht.createServer({ firewall, reusableSocket: true }, (socket) => onConnection(keepTunnelAlive(socket)))
  await server.listen(keyPair)
  // Lets in the same keys as the note: a private note's port goes only to
  // someone with its address.
  let portServer = null
  if (Number.isInteger(port) && port > 0) {
    portServer = lan.dht.createServer({ firewall, reusableSocket: true }, (socket) => {
      socket.on('error', () => {})
      socket.end(b4a.from(JSON.stringify({ port })))
    })
    await portServer.listen(notePortKeyPair(keyPair.publicKey)).catch(async () => {
      await portServer.close().catch(() => {})
      portServer = null
    })
  }
  const topic = noteTopic(keyPair.publicKey)
  try {
    lan.join(topic, { server: true, client: false })
  } catch (error) {
    await server.close().catch(() => {})
    await portServer?.close().catch(() => {})
    throw error
  }
  let closed = false
  return {
    // Which local network instance the note is on: when a new one starts,
    // the note has to be hosted there again (TunnelHost keeps it so).
    lan,
    async close () {
      if (closed) return
      closed = true
      try {
        lan.leave(topic)
      } catch {}
      await server.close().catch(() => {})
      await portServer?.close().catch(() => {})
    }
  }
}

/**
 * The port the host at address keeps the note on, or null from a host that
 * does not say, as an older PeerSky, or not in time.
 */
export function askNotePortOnLan (lan, { publicKey, keyPair = null, address, timeoutMs = LAN_PORT_MS }) {
  if (!usable(lan)) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    let socket = null
    let text = ''
    const finish = (port) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket?.destroy()
      resolve(port)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      socket = lan.dht.connect(notePortKeyPair(publicKey).publicKey, {
        ...(keyPair ? { keyPair } : {}),
        relayAddresses: [address],
        reusableSocket: true
      })
    } catch {
      return finish(null)
    }
    socket.on('data', (chunk) => {
      text += b4a.toString(chunk)
      if (text.length > 64) finish(null)
    })
    socket.once('end', () => {
      let port = null
      try {
        port = JSON.parse(text).port
      } catch {}
      finish(Number.isInteger(port) && port > 0 && port < 65536 ? port : null)
    })
    socket.once('error', () => finish(null))
    socket.once('close', () => finish(null))
  })
}

/** The host's address on the local network, or null when no host says so in time. */
export function findNoteOnLan (lan, publicKey, { timeoutMs = LAN_FIND_MS } = {}) {
  if (!usable(lan)) return Promise.resolve(null)
  if (typeof lan.dht.toArray === 'function' && lan.dht.toArray().length === 0) {
    timeoutMs = Math.min(timeoutMs, LAN_FIND_QUICK_MS)
  }
  const topic = noteTopic(publicKey)
  return new Promise((resolve) => {
    let done = false
    let timer = null
    const finish = (address) => {
      if (done) return
      done = true
      clearTimeout(timer)
      lan.off('peer', onPeer)
      lan.off('peer-reachable', onPeer)
      try {
        lan.leave(topic)
      } catch {}
      resolve(address)
    }
    const onPeer = (peer) => {
      if (!peer?.host || !peer?.port) return
      if (!(peer.topics || []).some((value) => b4a.equals(value, topic))) return
      finish({ host: peer.host, port: peer.port })
    }
    timer = setTimeout(() => finish(null), timeoutMs)
    lan.on('peer', onPeer)
    lan.on('peer-reachable', onPeer)
    try {
      lan.join(topic, { server: false, client: true })
    } catch {
      finish(null)
    }
  })
}

/** Whether a connection to the host at address opens in time. */
function reachNoteOnLan (connect, timeoutMs) {
  return new Promise((resolve) => {
    let done = false
    let timer = null
    let socket = null
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket?.destroy()
      resolve(ok)
    }
    timer = setTimeout(() => finish(false), timeoutMs)
    try {
      socket = connect()
    } catch {
      return finish(false)
    }
    socket.once('open', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

/**
 * The joining side: a way to reach the note's host over the local network,
 * found there and answering, or null, and the join goes to the internet as
 * before. keyPair is the note's own for a private note, which the host checks.
 */
export async function findNoteRouteOnLan (lan, { publicKey, keyPair = null, findMs = LAN_FIND_MS, reachMs = LAN_REACH_MS }) {
  const address = await findNoteOnLan(lan, publicKey, { timeoutMs: findMs })
  if (!address || !usable(lan)) return null
  const connect = () => lan.dht.connect(publicKey, {
    ...(keyPair ? { keyPair } : {}),
    relayAddresses: [address],
    reusableSocket: true
  })
  // Found but not answering, as on a Wi-Fi that keeps devices apart: the
  // internet is the way. The host's port is asked meanwhile.
  const [reached, port] = await Promise.all([
    reachNoteOnLan(connect, reachMs),
    askNotePortOnLan(lan, { publicKey, keyPair, address })
  ])
  if (!reached) return null
  // Where each connection goes: a local network instance and the host's
  // address on it. Both can change while the note is open, and moveTo()
  // points the next connections there (TunnelGuest keeps it current).
  // failedAt says a connection failed since the route last worked.
  const route = {
    lan,
    address,
    port,
    failedAt: 0,
    connect () {
      const current = route.lan
      if (!usable(current)) {
        route.failedAt = Date.now()
        return null
      }
      try {
        const socket = openWithin(keepTunnelAlive(current.dht.connect(publicKey, {
          ...(keyPair ? { keyPair } : {}),
          relayAddresses: [route.address],
          reusableSocket: true
        })), LAN_OPEN_MS)
        socket.once('open', () => { route.failedAt = 0 })
        socket.once('error', () => { route.failedAt = Date.now() })
        return socket
      } catch {
        route.failedAt = Date.now()
        return null
      }
    },
    moveTo (nextLan, nextAddress) {
      route.lan = nextLan
      route.address = nextAddress
      route.failedAt = 0
    }
  }
  return route
}
