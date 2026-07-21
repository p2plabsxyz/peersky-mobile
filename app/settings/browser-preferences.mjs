export const DEFAULT_BROWSER_PREFERENCES = {
  addressBarPosition: 'top',
  enforceManualPageZoom: false,
  restoreTabsOnStartup: true,
  searchEngine: 'duckduckgo',
  showFullAddress: false,
  theme: 'system',
  websiteTextScale: 100
}

export const ADDRESS_BAR_POSITIONS = ['top', 'bottom']
export const BROWSER_THEMES = ['system', 'light', 'dark']
export const WEBSITE_TEXT_SCALES = [80, 100, 120, 150]

export const SEARCH_ENGINES = /** @type {const} */ ([
  { id: 'duckduckgo', title: 'DuckDuckGo' },
  { id: 'brave', title: 'Brave Search' },
  { id: 'google', title: 'Google' }
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
    enforceManualPageZoom: typeof value?.enforceManualPageZoom === 'boolean'
      ? value.enforceManualPageZoom
      : DEFAULT_BROWSER_PREFERENCES.enforceManualPageZoom,
    restoreTabsOnStartup: typeof value?.restoreTabsOnStartup === 'boolean'
      ? value.restoreTabsOnStartup
      : DEFAULT_BROWSER_PREFERENCES.restoreTabsOnStartup,
    searchEngine: SEARCH_ENGINES.some((engine) => engine.id === value?.searchEngine)
      ? value.searchEngine
      : DEFAULT_BROWSER_PREFERENCES.searchEngine,
    showFullAddress: typeof value?.showFullAddress === 'boolean'
      ? value.showFullAddress
      : DEFAULT_BROWSER_PREFERENCES.showFullAddress,
    theme: BROWSER_THEMES.includes(value?.theme)
      ? value.theme
      : DEFAULT_BROWSER_PREFERENCES.theme,
    websiteTextScale: WEBSITE_TEXT_SCALES.includes(value?.websiteTextScale)
      ? value.websiteTextScale
      : DEFAULT_BROWSER_PREFERENCES.websiteTextScale
  }
}

export function serializeBrowserPreferences (preferences) {
  return JSON.stringify(parseBrowserPreferences(preferences))
}
