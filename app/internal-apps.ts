import type { ImageSourcePropType } from 'react-native'

import {
  INTERNAL_APPS as INTERNAL_APP_REGISTRY,
  P2P_APPS as P2P_APP_REGISTRY,
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

// The tile, not the bare bird. This one sits in the tab strip and on the home
// grid beside PeerChat and the rest, which are all tiles, and a loose bird
// among them reads as a missing icon rather than a different one.
//
// Not icon.png either: that is the store icon and has to be fully opaque,
// because iOS flattens any alpha onto white and shows a ring. Here it sits on
// our own surfaces and needs its transparent corners back.
export const BROWSER_HOME_ICON: ImageSourcePropType = require('../assets/images/home-icon.png')

type InternalAppEntry = {
  id: RuntimeTab
  title: string
  url: string
  icon: string
  devOnly?: boolean
}

function withIcon (app: InternalAppEntry) {
  return { ...app, iconSource: INTERNAL_APP_ICONS[app.id] }
}

export const INTERNAL_APPS = (INTERNAL_APP_REGISTRY as InternalAppEntry[]).map(withIcon)

// The apps a person can open. Holesail is left out: it is a development tool.
export const P2P_APPS = (P2P_APP_REGISTRY as InternalAppEntry[]).map(withIcon)

export function getRuntimeAppUrl (app: RuntimeTab) {
  return getRuntimeAppRegistryUrl(app)
}

export function getRuntimeAppFromUrl (targetUrl: string) {
  return getRuntimeAppFromRegistryUrl(targetUrl, { devApps: __DEV__ }) as RuntimeTab | null
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
