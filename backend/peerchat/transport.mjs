import compactEncoding from 'compact-encoding'
import Protomux from 'protomux'

import { PEERCHAT_PROTOCOL } from './protocol.mjs'

export function attachPeerChatTransport (connection, onMessage, options = {}) {
  const mux = Protomux.from(connection)
  const channel = mux.createChannel({
    protocol: PEERCHAT_PROTOCOL,
    onopen: () => options.onOpen?.(),
    onclose: (isRemote) => options.onClose?.(isRemote)
  })
  if (!channel) return null

  const message = channel.addMessage({
    encoding: compactEncoding.string,
    onmessage: onMessage
  })

  channel.open()

  return {
    send (payload) {
      if (channel.closed || connection.destroyed) return false
      return message.send(String(payload))
    },
    close () {
      if (!channel.closed) channel.close()
    }
  }
}
