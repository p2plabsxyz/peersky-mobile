// When the phone's network changes, its swarm is still announced where it
// was: at the old address, or on the Wi-Fi it just left. Peers then cannot
// find it until something refreshes the swarm, which until now was the app
// coming back to the foreground or a refresh every 15 minutes.
//
// A network is told apart by its kind and the phone's address on it, so a
// switch from Wi-Fi to mobile data counts, and so does a router handing out
// a new address overnight.
export function networkSignature (state, ipAddress) {
  if (!state || state.isConnected === false) return 'offline'
  const ip = typeof ipAddress === 'string' && ipAddress !== '0.0.0.0' ? ipAddress : ''
  return `${state.type || 'unknown'}|${ip}`
}

// The first look only sets the baseline, and there is nothing to announce
// while offline. Back online, even on the same network, the swarm has lost its
// connections and is refreshed.
export function shouldRefreshForNetwork (previous, next) {
  if (previous == null || next === 'offline') return false
  return previous !== next
}
