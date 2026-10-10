import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import {
  describeSiteData,
  filterSiteData,
  normalizeSiteDataList
} from '../privacy/site-data.mjs'
import { SettingCopy, SettingsSection, useSettingsDarkMode } from './SettingsUI'

type SiteDataEntry = {
  name: string
  cookies: boolean
  storage: boolean
}

type BrowserDataModule = {
  listSites?: (hosts: string[]) => Promise<unknown>
  removeSites?: (names: string[]) => Promise<unknown>
}

// Past this many, a search box helps find one.
const SEARCH_FROM = 8

/**
 * The sites that keep cookies or other data on this phone, each with a way to
 * remove it. Clearing website data in Settings keeps cookies on purpose, so
 * nobody is signed out of everything at once; this is where one goes.
 */
export function SiteData ({
  getSiteDataHosts
}: {
  // The sites Android is asked about, from history, tabs and bookmarks.
  getSiteDataHosts: () => string[]
}) {
  const isDark = useSettingsDarkMode()
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const browserData = NativeModules.PeerSkyBrowserData as BrowserDataModule | undefined
  const available = typeof browserData?.listSites === 'function' && typeof browserData?.removeSites === 'function'
  const [sites, setSites] = useState<SiteDataEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Read when the list loads, not a reason to load it again.
  const getHostsRef = useRef(getSiteDataHosts)
  getHostsRef.current = getSiteDataHosts

  const load = useCallback(async () => {
    if (!available) return
    try {
      const listed = await browserData.listSites?.(getHostsRef.current())
      setSites(normalizeSiteDataList(listed) as SiteDataEntry[])
      setError(null)
    } catch {
      setSites([])
      setError('The list of sites could not be read. Please try again.')
    }
  }, [available, browserData])

  useEffect(() => {
    void load()
  }, [load])

  async function remove (names: string[]) {
    if (!available || names.length === 0) return
    setBusy(true)
    try {
      await browserData.removeSites?.(names)
    } catch {
      setError('Some sites could not be removed. Please try again.')
    } finally {
      setBusy(false)
      void load()
    }
  }

  function confirmRemoveAll (names: string[]) {
    Alert.alert(
      `Remove data for ${names.length === 1 ? 'one site' : `all ${names.length} sites`}?`,
      'Their cookies and stored data are removed, so you will be signed out of them.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove all', style: 'destructive', onPress: () => void remove(names) }
      ]
    )
  }

  if (!available) {
    return (
      <View style={[styles.page, isDark ? styles.pageDark : null]}>
        <View style={styles.notice}>
          <Text style={[styles.noticeText, { color: palette.mutedText }]}>This version of PeerSky cannot list site data.</Text>
        </View>
      </View>
    )
  }

  const shown = sites ? filterSiteData(sites, query) as SiteDataEntry[] : []

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      <View style={styles.notice}>
        <Text style={[styles.noticeText, { color: palette.mutedText }]}>
          {Platform.OS === 'android'
            ? 'Sites from your history, tabs and bookmarks that keep cookies on this phone. Removing one signs you out of it.'
            : 'Sites that keep cookies or other data on this phone. Removing one signs you out of it.'}
        </Text>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      {sites === null
        ? <ActivityIndicator color={palette.accent} style={styles.loading} />
        : sites.length === 0
          ? (
            <SettingsSection title='Sites'>
              <View style={[styles.row, isDark ? styles.rowDark : null]}>
                <SettingCopy title='No site data' description='No site keeps cookies or data on this phone right now.' />
              </View>
            </SettingsSection>
            )
          : (
            <>
              {sites.length > SEARCH_FROM && (
                <TextInput
                  accessibilityLabel='Search sites'
                  autoCapitalize='none'
                  autoCorrect={false}
                  clearButtonMode='while-editing'
                  placeholder='Search sites'
                  placeholderTextColor={palette.mutedText}
                  style={[styles.search, { backgroundColor: palette.address, borderColor: palette.border, color: palette.text }]}
                  value={query}
                  onChangeText={setQuery}
                />
              )}
              <SettingsSection title={`${sites.length === 1 ? 'One site' : `${sites.length} sites`}`}>
                {shown.map((site) => (
                  <View key={site.name} style={[styles.row, isDark ? styles.rowDark : null]}>
                    <SettingCopy title={site.name} description={describeSiteData(site)} />
                    <Pressable
                      accessibilityLabel={`Remove data for ${site.name}`}
                      accessibilityRole='button'
                      accessibilityState={{ disabled: busy }}
                      disabled={busy}
                      hitSlop={6}
                      style={({ pressed }) => [styles.removeButton, pressed ? styles.pressed : null, busy ? styles.disabled : null]}
                      onPress={() => void remove([site.name])}
                    >
                      <Text style={[styles.removeText, isDark ? styles.removeTextDark : null]}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
                {shown.length === 0 && (
                  <View style={[styles.row, isDark ? styles.rowDark : null]}>
                    <SettingCopy title='No match' description={`No site with "${query.trim()}" in its name.`} />
                  </View>
                )}
              </SettingsSection>
              <SettingsSection title='All sites'>
                <Pressable
                  accessibilityRole='button'
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  style={({ pressed }) => [styles.row, isDark ? styles.rowDark : null, pressed ? styles.pressed : null, busy ? styles.disabled : null]}
                  onPress={() => confirmRemoveAll(sites.map((site) => site.name))}
                >
                  <SettingCopy title='Remove all site data' description='Signs you out of every site in this list.' />
                  <Text style={[styles.removeText, isDark ? styles.removeTextDark : null]}>{busy ? 'Removing...' : 'Remove all'}</Text>
                </Pressable>
              </SettingsSection>
            </>
            )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1,
    paddingBottom: 24
  },
  pageDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  notice: {
    paddingHorizontal: 20,
    paddingVertical: 16
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 18
  },
  error: {
    color: '#a7354a',
    fontSize: 13,
    paddingBottom: 10,
    paddingHorizontal: 20
  },
  loading: {
    marginTop: 24
  },
  search: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    marginBottom: 12,
    marginHorizontal: 16,
    minHeight: 42,
    paddingHorizontal: 12
  },
  row: {
    alignItems: 'center',
    borderBottomColor: '#e6ecf5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  rowDark: {
    borderBottomColor: BROWSER_PALETTES.dark.border
  },
  removeButton: {
    paddingHorizontal: 4,
    paddingVertical: 8
  },
  removeText: {
    color: '#a7354a',
    fontSize: 14,
    fontWeight: '800'
  },
  removeTextDark: {
    color: '#ff9aad'
  },
  pressed: {
    opacity: 0.6
  },
  disabled: {
    opacity: 0.45
  }
})
