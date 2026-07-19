export const DEFAULT_BROWSER_PREFERENCES = {
  restoreTabsOnStartup: true,
  searchEngine: 'duckduckgo'
}

export const SEARCH_ENGINES = [
  { id: 'duckduckgo', title: 'DuckDuckGo' },
  { id: 'brave', title: 'Brave Search' },
  { id: 'google', title: 'Google' }
]

export function parseBrowserPreferences (serialized) {
  let value

  try {
    value = typeof serialized === 'string' ? JSON.parse(serialized) : serialized
  } catch {
    return { ...DEFAULT_BROWSER_PREFERENCES }
  }

  return {
    restoreTabsOnStartup: typeof value?.restoreTabsOnStartup === 'boolean'
      ? value.restoreTabsOnStartup
      : DEFAULT_BROWSER_PREFERENCES.restoreTabsOnStartup,
    searchEngine: SEARCH_ENGINES.some((engine) => engine.id === value?.searchEngine)
      ? value.searchEngine
      : DEFAULT_BROWSER_PREFERENCES.searchEngine
  }
}

export function serializeBrowserPreferences (preferences) {
  return JSON.stringify(parseBrowserPreferences(preferences))
}
