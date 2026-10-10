import { DEFAULT_APP_LOGO_COLOR, normalizeAppLogoColor } from '../app-logo-colors.mjs'
import { EXTERNAL_LINK_BEHAVIORS } from '../browser-permissions.mjs'
import { isBridgeSiteId, normalizeCustomSearchUrl } from '../browser-shell.mjs'
import { DEFAULT_TOOLBAR_BUTTON, normalizeToolbarButton } from '../toolbar-button.mjs'

export const DEFAULT_BROWSER_PREFERENCES = {
  addressBarPosition: 'top',
  appLogoColor: DEFAULT_APP_LOGO_COLOR,
  contentBlockingEnabled: true,
  customSearchUrl: '',
  downloadOnlyOnWifi: false,
  enforceManualPageZoom: false,
  externalLinkBehavior: 'ask',
  forceDarkWebsites: false,
  publishingSites: {},
  searchEngine: 'duckduckgo',
  searchSuggestionsEnabled: true,
  showFullAddress: false,
  theme: 'system',
  toolbarButton: DEFAULT_TOOLBAR_BUTTON,
  websiteTextScale: 100,
  youtubeAdBlockingEnabled: true
}

export const ADDRESS_BAR_POSITIONS = ['top', 'bottom']
export const PUBLISHING_DECISIONS = ['allow', 'block']
export const MAX_PUBLISHING_SITES = 200
export const BROWSER_THEMES = ['system', 'light', 'dark']
export const WEBSITE_TEXT_SCALES = [80, 100, 120, 150]

export const SEARCH_ENGINES = /** @type {const} */ ([
  { id: 'duckduckgo', title: 'DuckDuckGo' },
  { id: 'duckduckgo-noai', title: 'DuckDuckGo (no AI)' },
  { id: 'startpage', title: 'Startpage' },
  { id: 'ecosia', title: 'Ecosia' },
  { id: 'kagi', title: 'Kagi' },
  { id: 'custom', title: 'Custom' }
])

export function parseBrowserPreferences (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return { ...DEFAULT_BROWSER_PREFERENCES }
  }

  return {
    addressBarPosition: ADDRESS_BAR_POSITIONS.includes(value?.addressBarPosition)
      ? value.addressBarPosition
      : DEFAULT_BROWSER_PREFERENCES.addressBarPosition,
    appLogoColor: normalizeAppLogoColor(value?.appLogoColor),
    contentBlockingEnabled: typeof value?.contentBlockingEnabled === 'boolean'
      ? value.contentBlockingEnabled
      : DEFAULT_BROWSER_PREFERENCES.contentBlockingEnabled,
    customSearchUrl: normalizeCustomSearchUrl(value?.customSearchUrl) || '',
    downloadOnlyOnWifi: typeof value?.downloadOnlyOnWifi === 'boolean'
      ? value.downloadOnlyOnWifi
      : DEFAULT_BROWSER_PREFERENCES.downloadOnlyOnWifi,
    enforceManualPageZoom: typeof value?.enforceManualPageZoom === 'boolean'
      ? value.enforceManualPageZoom
      : DEFAULT_BROWSER_PREFERENCES.enforceManualPageZoom,
    externalLinkBehavior: EXTERNAL_LINK_BEHAVIORS.includes(value?.externalLinkBehavior)
      ? value.externalLinkBehavior
      : DEFAULT_BROWSER_PREFERENCES.externalLinkBehavior,
    forceDarkWebsites: typeof value?.forceDarkWebsites === 'boolean'
      ? value.forceDarkWebsites
      : DEFAULT_BROWSER_PREFERENCES.forceDarkWebsites,
    publishingSites: normalizePublishingSites(value?.publishingSites),
    searchEngine: SEARCH_ENGINES.some((engine) => engine.id === value?.searchEngine)
      ? value.searchEngine
      : DEFAULT_BROWSER_PREFERENCES.searchEngine,
    searchSuggestionsEnabled: typeof value?.searchSuggestionsEnabled === 'boolean'
      ? value.searchSuggestionsEnabled
      : DEFAULT_BROWSER_PREFERENCES.searchSuggestionsEnabled,
    showFullAddress: typeof value?.showFullAddress === 'boolean'
      ? value.showFullAddress
      : DEFAULT_BROWSER_PREFERENCES.showFullAddress,
    theme: BROWSER_THEMES.includes(value?.theme)
      ? value.theme
      : DEFAULT_BROWSER_PREFERENCES.theme,
    toolbarButton: normalizeToolbarButton(value?.toolbarButton),
    websiteTextScale: WEBSITE_TEXT_SCALES.includes(value?.websiteTextScale)
      ? value.websiteTextScale
      : DEFAULT_BROWSER_PREFERENCES.websiteTextScale,
    youtubeAdBlockingEnabled: typeof value?.youtubeAdBlockingEnabled === 'boolean'
      ? value.youtubeAdBlockingEnabled
      : DEFAULT_BROWSER_PREFERENCES.youtubeAdBlockingEnabled
  }
}

/**
 * Which sites may publish from this phone, a hyper:// site by the host in its
 * address and an https:// one by its origin, as the person answered when each
 * one first asked.
 */
export function normalizePublishingSites (value) {
  const sites = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return sites
  for (const [siteId, decision] of Object.entries(value)) {
    if (Object.keys(sites).length >= MAX_PUBLISHING_SITES) break
    if (isBridgeSiteId(siteId) && PUBLISHING_DECISIONS.includes(decision)) sites[siteId] = decision
  }
  return sites
}

export function serializeBrowserPreferences (preferences) {
  return JSON.stringify(parseBrowserPreferences(preferences))
}
