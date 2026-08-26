import dgram from 'bare-dgram'
import BonjourModule from 'bonjour-service'

const DefaultBonjour = BonjourModule.Bonjour || BonjourModule

export function createMobileMDNSOptions (host, options = {}) {
  const createSocket = options.createSocket || ((socketOptions) => dgram.createSocket(socketOptions))
  const Bonjour = options.Bonjour || DefaultBonjour

  return {
    createBonjour: (onError) => {
      const socket = addMulticastSupport(createSocket({ reuseAddress: true }))
      const bonjour = new Bonjour({
        bind: '0.0.0.0',
        interface: host,
        socket
      }, onError)
      const publish = bonjour.publish.bind(bonjour)
      bonjour.publish = (record) => publish({
        ...record,
        disableIPv6: true,
        probe: false
      })
      return bonjour
    }
  }
}

export function addMulticastSupport (socket) {
  const nativeSocket = socket?._socket
  if (!nativeSocket) throw new Error('Bare UDP socket is unavailable')

  socket.addMembership = (group, interfaceAddress) => {
    nativeSocket.addMembership(group, interfaceAddress)
    return socket
  }
  socket.dropMembership = (group, interfaceAddress) => {
    nativeSocket.dropMembership(group, interfaceAddress)
    return socket
  }

  // udx-native exposes only unicast IP_TTL, not IP_MULTICAST_TTL. Keep the
  // multicast-dns API shim without calling setTTL: mobile mDNS therefore uses
  // the OS multicast default (normally 1), which is same-link only and may be
  // rejected by RFC 6762 responders that enforce a received TTL of 255.
  socket.setMulticastTTL = () => socket

  // bare-dgram/udx-native do not expose these multicast controls. Loopback is
  // left at the OS default and interface selection relies on Bonjour's bind.
  socket.setMulticastLoopback = () => socket
  socket.setMulticastInterface = () => socket

  return socket
}
