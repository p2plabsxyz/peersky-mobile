import { Linking } from 'react-native'

import { createIncomingUrlQueue } from './incoming-url-queue.mjs'

// Module scope on purpose: this has to outlive the browser screen, which
// expo-router unmounts and remounts on its way through the unmatched route
// whenever a peersky:// link arrives. See incoming-url-queue.mjs.
const queue = createIncomingUrlQueue()

Linking.addEventListener('url', (event) => queue.push(event.url))
void Linking.getInitialURL()
  .then((url) => queue.push(url))
  .catch((error) => console.warn('Unable to read the launch URL:', error))

/** Replays any link the browser has not handled yet, then follows new ones. */
export function subscribeToIncomingUrls (listener: (url: string) => void) {
  return queue.subscribe(listener)
}

/** Says a link has been dealt with, so it is not replayed on the next mount. */
export function settleIncomingUrl (url: string) {
  queue.settle(url)
}
