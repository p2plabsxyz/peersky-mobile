/**
 * expo-router parses every link the system hands the app before anything else
 * sees it, query string and all, with a decoder a crafted link can keep busy
 * for a long time. The browser reads links itself (incoming-links.ts), so the
 * router only needs its one screen: it opens on "/" and later links never move
 * it, which also stops each one from remounting the browser.
 */
export function redirectSystemPath ({ initial }: { path: string, initial: boolean }) {
  return initial ? '/' : null
}
