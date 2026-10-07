import { useEffect, useRef } from 'react'
import * as Network from 'expo-network'
import { addPeerChatBackgroundTickListener } from './peerchat/background-service'
import { networkSignature, shouldRefreshForNetwork } from './network-change.mjs'

// Refreshes the swarm when the network changes (see network-change.mjs). The
// system says when the kind of network changes; a new address on the same
// Wi-Fi it does not, so the minute tick of the Android background service
// also looks, which keeps a phone left alone for days reachable.
export function useHyperNetworkRefresh (enabled: boolean, refresh: () => Promise<unknown>) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let checking = false
    let last: string | null = null

    const check = async () => {
      if (checking) return
      checking = true
      try {
        const [state, ip] = await Promise.all([
          Network.getNetworkStateAsync(),
          Network.getIpAddressAsync().catch(() => '')
        ])
        if (cancelled) return
        const next = networkSignature(state, ip)
        if (shouldRefreshForNetwork(last, next)) {
          void refreshRef.current().catch((error) => {
            console.warn('Unable to refresh Hyper networking after a network change:', error)
          })
        }
        last = next
      } catch {
        // Unknown this time; the next change or tick looks again.
      } finally {
        checking = false
      }
    }

    void check()
    const networkSubscription = Network.addNetworkStateListener(() => { void check() })
    const tickSubscription = addPeerChatBackgroundTickListener(() => { void check() })
    return () => {
      cancelled = true
      networkSubscription.remove()
      tickSubscription.remove()
    }
  }, [enabled])
}
