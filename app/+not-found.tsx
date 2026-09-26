import { Redirect } from 'expo-router'

/**
 * The browser is a single route. Anything else that arrives is a deep link,
 * such as a peersky://p2p/peerchat/#room=... invite opened from Notes or
 * scanned with the camera, and expo-router was answering those with its own
 * "Unmatched Route" page before the app ever saw them.
 *
 * Handing the router back to the browser lets the Linking listener in
 * index.tsx pick the address up and open it, which is what it was always
 * meant to do. The URL survives the redirect: getInitialURL reads what the
 * system launched us with, not where the router happens to be.
 */
export default function NotFoundRoute () {
  return <Redirect href='/' />
}
