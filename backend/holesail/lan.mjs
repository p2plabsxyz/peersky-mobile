import { createHash } from 'node:crypto'
import b4a from 'b4a'

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

function usable (lan) {
  return Boolean(lan?.dht) && !lan.destroyed
}

/**
 * The host: the note served on the LAN DHT too, each connection handed to
 * onConnection as the internet ones are, and its topic said over mDNS.
 */
export async function hostNoteOnLan (lan, { keyPair, secure, onConnection }) {
  if (!usable(lan) || !keyPair) return null
  const server = lan.dht.createServer({
    firewall: secure ? (remotePublicKey) => !b4a.equals(remotePublicKey, keyPair.publicKey) : undefined,
    reusableSocket: true
  }, onConnection)
  await server.listen(keyPair)
  const topic = noteTopic(keyPair.publicKey)
  try {
    lan.join(topic, { server: true, client: false })
  } catch (error) {
    await server.close().catch(() => {})
    throw error
  }
  let closed = false
  return {
    async close () {
      if (closed) return
      closed = true
      try {
        lan.leave(topic)
      } catch {}
      await server.close().catch(() => {})
    }
  }
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
  // internet is the way.
  if (!await reachNoteOnLan(connect, reachMs)) return null
  return {
    address,
    connect: () => usable(lan) ? connect() : null
  }
}
