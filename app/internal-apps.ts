import type { ImageSourcePropType } from 'react-native'

import {
  INTERNAL_APPS as INTERNAL_APP_REGISTRY,
  getRuntimeAppFromUrl as getRuntimeAppFromRegistryUrl,
  getRuntimeAppTitle as getRuntimeAppRegistryTitle,
  getRuntimeAppUrl as getRuntimeAppRegistryUrl
} from './internal-apps-registry.mjs'

export type RuntimeTab = 'hyper' | 'holesail' | 'p2pmd' | 'peerchat'

const INTERNAL_APP_ICONS: Partial<Record<RuntimeTab, ImageSourcePropType>> = {
  hyper: require('../assets/images/hyperdrive.png'),
  p2pmd: require('../assets/images/p2pmd.png')
}

export const BROWSER_HOME_ICON: ImageSourcePropType = require('../assets/images/icon.png')

export const INTERNAL_APPS = (INTERNAL_APP_REGISTRY as Array<{
  id: RuntimeTab
  title: string
  url: string
  icon: string
}>).map((app) => ({
  ...app,
  iconSource: INTERNAL_APP_ICONS[app.id]
}))

export function getRuntimeAppUrl (app: RuntimeTab) {
  return getRuntimeAppRegistryUrl(app)
}

export function getRuntimeAppFromUrl (targetUrl: string) {
  return getRuntimeAppFromRegistryUrl(targetUrl) as RuntimeTab | null
}

export function getRuntimeAppTitle (app: RuntimeTab) {
  return getRuntimeAppRegistryTitle(app)
}

export function getRuntimeAppIconSource (app: RuntimeTab) {
  return INTERNAL_APP_ICONS[app] || null
}
