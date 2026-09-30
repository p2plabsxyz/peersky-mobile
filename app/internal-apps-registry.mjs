export const INTERNAL_APPS = [
  {
    id: 'hyper',
    title: 'Hyperdrive',
    url: 'peersky://p2p/hyperdrive/',
    icon: 'H'
  },
  {
    id: 'p2pmd',
    title: 'P2PMD',
    url: 'peersky://p2p/p2pmd/',
    icon: 'MD'
  },
  {
    id: 'peerchat',
    title: 'PeerChat',
    url: 'peersky://p2p/peerchat/',
    icon: 'PC'
  },
  {
    id: 'peertunes',
    title: 'PeerTunes',
    url: 'peersky://p2p/peertunes/',
    icon: 'PT'
  },
  // A runtime check for working on the tunnel P2PMD rides on, not an app
  // anyone uses. It only exists in development builds.
  {
    id: 'holesail',
    title: 'Holesail',
    url: 'peersky://holesail/',
    icon: 'HS',
    devOnly: true
  }
]

// React Native defines __DEV__ before any module runs; under node it is not
// there, which reads as a release build.
const DEV_APPS_ENABLED = globalThis.__DEV__ === true

// What peersky://p2p and the home screen list. Development tools never show
// up here, even in a development build.
export const P2P_APPS = INTERNAL_APPS.filter((app) => !app.devOnly)

const LEGACY_INTERNAL_APP_ROUTES = new Map([
  ['peersky://hyper', 'hyper'],
  ['peersky://hyperdrive', 'hyper']
])

// Share links keep their payload in the query or fragment, for example
// peersky://p2p/peertunes/#playlist=hyper%3A%2F%2F... The tail is passed to
// the app page untouched, so it is capped and kept free of markup characters.
const MAX_LAUNCH_SUFFIX_LENGTH = 4096

export function getRuntimeAppUrl (app) {
  const match = INTERNAL_APPS.find((item) => item.id === app)
  return match?.url || 'peersky://p2p/p2pmd/'
}

export function getRuntimeAppFromUrl (targetUrl, { devApps = DEV_APPS_ENABLED } = {}) {
  const normalizedUrl = normalizeInternalAppUrl(targetUrl)
  const app = INTERNAL_APPS.find((item) => normalizeInternalAppUrl(item.url) === normalizedUrl)
  // In a release build peersky://holesail is just an address nothing answers.
  if (app && app.devOnly && !devApps) return null
  return app?.id || LEGACY_INTERNAL_APP_ROUTES.get(normalizedUrl) || null
}

export function getRuntimeAppTitle (app) {
  return INTERNAL_APPS.find((item) => item.id === app)?.title || 'P2PMD'
}

export function getRuntimeAppLaunchSuffix (targetUrl) {
  const value = String(targetUrl || '')
  const index = value.search(/[?#]/)
  if (index === -1) return ''

  const suffix = value.slice(index)
  if (suffix.length > MAX_LAUNCH_SUFFIX_LENGTH) return ''
  if (/[\s<>"'`\\]/.test(suffix)) return ''

  return suffix
}

export function canUseP2pAppPageActions (app, targetUrl) {
  const registeredUrl = getRuntimeAppUrl(app)
  return registeredUrl.startsWith('peersky://p2p/') &&
    normalizeInternalAppUrl(registeredUrl) === normalizeInternalAppUrl(targetUrl)
}

function normalizeInternalAppUrl (targetUrl) {
  return String(targetUrl || '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}
