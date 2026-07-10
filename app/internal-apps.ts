export type RuntimeTab = 'hyper' | 'holesail' | 'p2pmd'

export const INTERNAL_APPS: Array<{
  id: RuntimeTab
  title: string
  url: string
  icon: string
}> = [
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

export function getRuntimeAppUrl (app: RuntimeTab) {
  const match = INTERNAL_APPS.find((item) => item.id === app)
  return match?.url || 'peersky://p2p/p2pmd/'
}

export function getRuntimeAppFromUrl (targetUrl: string) {
  const normalizedUrl = normalizeInternalAppUrl(targetUrl)
  return INTERNAL_APPS.find((app) => normalizeInternalAppUrl(app.url) === normalizedUrl)?.id || null
}

export function getRuntimeAppTitle (app: RuntimeTab) {
  if (app === 'hyper') return 'Hyper Runtime'
  if (app === 'holesail') return 'Holesail'
  return 'P2PMD'
}

function normalizeInternalAppUrl (targetUrl: string) {
  return targetUrl.replace(/\/+$/, '').toLowerCase()
}
