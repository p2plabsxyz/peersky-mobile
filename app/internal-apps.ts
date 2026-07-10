import {
  INTERNAL_APPS as INTERNAL_APP_REGISTRY,
  getRuntimeAppFromUrl as getRuntimeAppFromRegistryUrl,
  getRuntimeAppTitle as getRuntimeAppRegistryTitle,
  getRuntimeAppUrl as getRuntimeAppRegistryUrl
} from './internal-apps-registry.mjs'

export type RuntimeTab = 'hyper' | 'holesail' | 'p2pmd'

export const INTERNAL_APPS = INTERNAL_APP_REGISTRY as Array<{
  id: RuntimeTab
  title: string
  url: string
  icon: string
}>

export function getRuntimeAppUrl (app: RuntimeTab) {
  return getRuntimeAppRegistryUrl(app)
}

export function getRuntimeAppFromUrl (targetUrl: string) {
  return getRuntimeAppFromRegistryUrl(targetUrl) as RuntimeTab | null
}

export function getRuntimeAppTitle (app: RuntimeTab) {
  return getRuntimeAppRegistryTitle(app)
}
