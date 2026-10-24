import compactEncoding from 'compact-encoding'
import b4a from 'b4a'
import Protomux from 'protomux'

import { MAX_PEERCHAT_FRAME_BYTES, PEERCHAT_PROTOCOL } from './protocol.mjs'

const boundedStringEncoding = {
  preencode (state, value) {
    assertFrameSize(value)
    compactEncoding.string.preencode(state, value)
  },
  encode (state, value) {
    assertFrameSize(value)
    compactEncoding.string.encode(state, value)
  },
  decode (state) {
    const length = compactEncoding.uint.decode(state)
    if (length > MAX_PEERCHAT_FRAME_BYTES) throw new Error('PeerChat frame is too large')
    if (state.end - state.start < length) throw new Error('PeerChat frame is incomplete')
    const start = state.start
    state.start += length
    return b4a.toString(state.buffer, 'utf8', start, state.start)
  }
}

export function attachPeerChatTransport (connection, onMessage, options = {}) {
  const mux = Protomux.from(connection)
  const channel = mux.createChannel({
    protocol: PEERCHAT_PROTOCOL,
    onopen: () => options.onOpen?.(),
    onclose: (isRemote) => options.onClose?.(isRemote)
  })
  if (!channel) return null

  const message = channel.addMessage({
    encoding: boundedStringEncoding,
    onmessage: onMessage
  })

  channel.open()

  return {
    get opened () {
      return channel.opened
    },
    get closed () {
      return channel.closed || connection.destroyed
    },
    ready () {
      return channel.fullyOpened()
    },
    send (payload) {
      if (channel.closed || connection.destroyed) return false
      return message.send(String(payload))
    },
    close () {
      if (!channel.closed) channel.close()
    }
  }
}

// While the other end of a local network connection is still proving who it
// is, a PeerChat channel it opens first is held, not refused: protomux
// refuses a channel this side has not opened yet, and the two sides finish
// proving at different moments. Returns what lets it go, once this side has
// opened its own channel or decided not to.
export function holdPeerChatTransport (connection) {
  const mux = Protomux.from(connection)
  let release = null
  const released = new Promise((resolve) => { release = resolve })
  mux.pair({ protocol: PEERCHAT_PROTOCOL }, () => released)
  return () => {
    mux.unpair({ protocol: PEERCHAT_PROTOCOL })
    release()
  }
}

function assertFrameSize (value) {
  if (b4a.byteLength(String(value), 'utf8') > MAX_PEERCHAT_FRAME_BYTES) {
    throw new Error('PeerChat frame is too large')
  }
}
