export const HYPERDRIVE_VIEWER_LOOPBACK_HOST = '127.0.0.1'

// Fixed on purpose, as PeerTunes' is. The viewer keeps the small pictures and
// details it made of public drives in its origin's IndexedDB, and the origin
// is host:port, so a stable port is what keeps them across app launches.
export const HYPERDRIVE_VIEWER_LOOPBACK_PORT = 47318
