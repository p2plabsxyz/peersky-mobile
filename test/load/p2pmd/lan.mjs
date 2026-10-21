// The local network side of the load test run with --lan, the phone's own. Each
// editor is a device of its own on the Wi-Fi, with a local network instance as
// the app runs one (hyperdht-mdns, found over real mDNS), and joins the note
// through the phone's own tunnel (TunnelGuest in backend/holesail/tunnel.mjs).
// host.mjs hosts the note with the phone's TunnelHost on one of these. Nothing
// goes to the internet: its DHT has nobody to bootstrap from, as with the
// router's cable out.
import dgram from 'node:dgram'
import HyperDHTmDNS from '@p2plabs/hyperdht-mdns'
import { TunnelGuest } from '../../../backend/holesail/tunnel.mjs'

export const OFFLINE = []
// How long a device waits to see another PeerSky on the local network.
const SEE_OTHERS_MS = 20000

// A local network instance on a port of its own, so many fit on one machine.
// It takes no port 0, so a free one is found first, and another if that one
// is taken by the time it binds.
export async function startLan () {
  for (let attempt = 1; ; attempt++) {
    const lan = new HyperDHTmDNS({ port: await freeUdpPort(), allowLoopback: true })
    lan.on('error', (error) => console.error('[lan]', error?.message || error))
    // Devices that share a topic connect, and the app hands those connections
    // to Hyperdrive and PeerChat. Nothing here uses them.
    lan.on('connection', (socket) => socket.on('error', () => {}))
    try {
      await lan.ready()
      return lan
    } catch (error) {
      await lan.destroy().catch(() => {})
      if (attempt === 5) throw error
    }
  }
}

function freeUdpPort () {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4')
    socket.once('error', reject)
    socket.bind(0, () => {
      const { port } = socket.address()
      socket.close(() => resolve(port))
    })
  })
}

// Someone with PeerSky on the same Wi-Fi, on it before they join, as a phone
// that has been on the Wi-Fi a while is: it has seen the others there.
export async function startDevice () {
  const lan = await startLan()
  const until = Date.now() + SEE_OTHERS_MS
  while (lan.dht.toArray().length === 0) {
    if (Date.now() > until) {
      await lan.destroy().catch(() => {})
      throw new Error('This device saw nobody else on the local network')
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const tunnels = new Set()
  return {
    // The note, joined as the phone joins one, on any free port here: every
    // device is on this one machine, and the host has the note's own port.
    async open ({ address }) {
      const guest = new TunnelGuest({ key: address, port: 0, lan, getLan: () => lan, bootstrap: OFFLINE })
      tunnels.add(guest)
      await guest.open()
      if (!guest.lanRoute) throw new Error('The note was not found on the local network')
      return { url: `http://127.0.0.1:${guest.port}` }
    },
    async close () {
      for (const guest of tunnels) await guest.close().catch(() => {})
      await lan.destroy().catch(() => {})
    }
  }
}
