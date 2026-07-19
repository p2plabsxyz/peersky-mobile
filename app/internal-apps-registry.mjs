export const INTERNAL_APPS = [
  {
    id: 'p2pmd',
    title: 'P2PMD',
    url: 'peersky://p2p/p2pmd/',
    icon: 'MD'
  },
  {
    id: 'holesail',
    title: 'Holesail',
    url: 'peersky://holesail/',
    icon: 'HS'
  },
  {
    id: 'hyper',
    title: 'Hyper Runtime',
    url: 'peersky://hyper/',
    icon: 'H'
  }
]

export function getRuntimeAppUrl (app) {
  const match = INTERNAL_APPS.find((item) => item.id === app)
  return match?.url || 'peersky://p2p/p2pmd/'
}

export function getRuntimeAppFromUrl (targetUrl) {
  const normalizedUrl = normalizeInternalAppUrl(targetUrl)
  return INTERNAL_APPS.find((app) => normalizeInternalAppUrl(app.url) === normalizedUrl)?.id || null
}

export function getRuntimeAppTitle (app) {
  return INTERNAL_APPS.find((item) => item.id === app)?.title || 'P2PMD'
}

function normalizeInternalAppUrl (targetUrl) {
  return String(targetUrl || '').replace(/\/+$/, '').toLowerCase()
}
