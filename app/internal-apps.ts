import type { ImageSourcePropType } from 'react-native'

import {
  INTERNAL_APPS as INTERNAL_APP_REGISTRY,
  canUseP2pAppPageActions as canUseP2pAppRegistryPageActions,
  getRuntimeAppFromUrl as getRuntimeAppFromRegistryUrl,
  getRuntimeAppLaunchSuffix as getRuntimeAppRegistryLaunchSuffix,
  getRuntimeAppTitle as getRuntimeAppRegistryTitle,
  getRuntimeAppUrl as getRuntimeAppRegistryUrl
} from './internal-apps-registry.mjs'

export type RuntimeTab = 'hyper' | 'holesail' | 'p2pmd' | 'peerchat' | 'peertunes'

const INTERNAL_APP_ICONS: Partial<Record<RuntimeTab, ImageSourcePropType>> = {
  hyper: require('../assets/images/hyperdrive.png'),
  p2pmd: require('../assets/images/p2pmd.png'),
  peerchat: require('../assets/images/peerchat.png'),
  peertunes: require('../assets/images/peertunes.png')
}

// Not icon.png: that one is the store icon and has to be fully opaque, because
// iOS flattens any alpha onto white and shows a ring. In the app the icon sits
// on our own surfaces and needs its transparent corners back.
export const BROWSER_HOME_ICON: ImageSourcePropType = require('../assets/images/logo.png')

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

export function canUseP2pAppPageActions (app: RuntimeTab, targetUrl: string) {
  return canUseP2pAppRegistryPageActions(app, targetUrl)
}

export function getRuntimeAppLaunchSuffix (targetUrl: string) {
  return getRuntimeAppRegistryLaunchSuffix(targetUrl) as string
}

export function getRuntimeAppIconSource (app: RuntimeTab) {
  return INTERNAL_APP_ICONS[app] || null
}
