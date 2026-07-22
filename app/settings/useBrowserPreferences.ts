import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import {
  DEFAULT_BROWSER_PREFERENCES,
  parseBrowserPreferences,
  serializeBrowserPreferences
} from './browser-preferences.mjs'

export type SearchEngine = 'duckduckgo' | 'brave' | 'google'
export type AddressBarPosition = 'top' | 'bottom'
export type BrowserTheme = 'system' | 'light' | 'dark'
export type ExternalLinkBehavior = 'ask' | 'allow' | 'block'
export type WebsiteTextScale = 80 | 100 | 120 | 150

export type BrowserPreferences = {
  addressBarPosition: AddressBarPosition
  enforceManualPageZoom: boolean
  externalLinkBehavior: ExternalLinkBehavior
  restoreTabsOnStartup: boolean
  searchEngine: SearchEngine
  showFullAddress: boolean
  theme: BrowserTheme
  websiteTextScale: WebsiteTextScale
}

export function useBrowserPreferences () {
  const [preferences, setPreferences] = useState<BrowserPreferences>(
    DEFAULT_BROWSER_PREFERENCES as BrowserPreferences
  )
  const preferencesRef = useRef(preferences)
  const [isReady, setIsReady] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPreferences () {
      try {
        const file = getPreferencesFile()
        if (!file.exists) return

        const restored = parseBrowserPreferences(await file.text()) as BrowserPreferences
        if (!cancelled) {
          preferencesRef.current = restored
          setPreferences(restored)
        }
      } catch (error) {
        console.error('Failed loading browser preferences:', error)
        if (!cancelled) setPersistenceError('Unable to load browser preferences. Defaults are being used.')
      } finally {
        if (!cancelled) setIsReady(true)
      }
    }

    void loadPreferences()
    return () => {
      cancelled = true
    }
  }, [])

  function updatePreferences (patch: Partial<BrowserPreferences>) {
    if (!isReady) {
      setPersistenceError('Browser preferences are still loading. Try again in a moment.')
      return false
    }

    const nextPreferences = { ...preferencesRef.current, ...patch }
    try {
      writePreferences(nextPreferences)
      preferencesRef.current = nextPreferences
      setPreferences(nextPreferences)
      setPersistenceError(null)
      return true
    } catch (error) {
      console.error('Failed saving browser preferences:', error)
      setPersistenceError('Unable to save this preference. Your previous setting is unchanged.')
      return false
    }
  }

  return {
    isReady,
    persistenceError,
    preferences,
    setAddressBarPosition: (addressBarPosition: AddressBarPosition) => {
      return updatePreferences({ addressBarPosition })
    },
    setEnforceManualPageZoom: (enforceManualPageZoom: boolean) => {
      return updatePreferences({ enforceManualPageZoom })
    },
    setExternalLinkBehavior: (externalLinkBehavior: ExternalLinkBehavior) => {
      return updatePreferences({ externalLinkBehavior })
    },
    setRestoreTabsOnStartup: (enabled: boolean) => {
      return updatePreferences({ restoreTabsOnStartup: enabled })
    },
    setSearchEngine: (searchEngine: SearchEngine) => {
      return updatePreferences({ searchEngine })
    },
    setShowFullAddress: (showFullAddress: boolean) => {
      return updatePreferences({ showFullAddress })
    },
    setTheme: (theme: BrowserTheme) => {
      return updatePreferences({ theme })
    },
    setWebsiteTextScale: (websiteTextScale: WebsiteTextScale) => {
      return updatePreferences({ websiteTextScale })
    }
  }
}

function getPreferencesFile () {
  return new File(Paths.document, 'browser-preferences.json')
}

function writePreferences (preferences: BrowserPreferences) {
  const file = getPreferencesFile()
  if (!file.exists) file.create({ intermediates: true })
  file.write(serializeBrowserPreferences(preferences))
}
