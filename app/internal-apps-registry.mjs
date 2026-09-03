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
    id: 'holesail',
    title: 'Holesail',
    url: 'peersky://holesail/',
    icon: 'HS'
  }
]

const LEGACY_INTERNAL_APP_ROUTES = new Map([
  ['peersky://hyper', 'hyper'],
  ['peersky://hyperdrive', 'hyper']
])

export function getRuntimeAppUrl (app) {
  const match = INTERNAL_APPS.find((item) => item.id === app)
  return match?.url || 'peersky://p2p/p2pmd/'
}

export function getRuntimeAppFromUrl (targetUrl) {
  const normalizedUrl = normalizeInternalAppUrl(targetUrl)
  return INTERNAL_APPS.find((app) => normalizeInternalAppUrl(app.url) === normalizedUrl)?.id ||
    LEGACY_INTERNAL_APP_ROUTES.get(normalizedUrl) || null
}

export function getRuntimeAppTitle (app) {
  return INTERNAL_APPS.find((item) => item.id === app)?.title || 'P2PMD'
}

function normalizeInternalAppUrl (targetUrl) {
  return String(targetUrl || '').replace(/\/+$/, '').toLowerCase()
}
