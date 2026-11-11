import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import {
  CUSTOM_SEARCH_QUERY_PLACEHOLDER,
  normalizeCustomSearchUrl
} from '../browser-shell.mjs'
import { t, tKey } from '../i18n/i18n.mjs'
import { SEARCH_ENGINES } from './browser-preferences.mjs'
import { findSearchEngines, searchEngineForUrl } from './search-engine-match.mjs'
import { LanguageSection } from './Language'
import {
  ChoiceGroup,
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode,
  useSettingsReveal
} from './SettingsUI'
import type { SearchEngine } from './useBrowserPreferences'

type GeneralProps = {
  customSearchUrl: string
  forceDarkWebsites: boolean
  // 'system', or the code of the language picked in PeerSky.
  language: string
  persistenceError: string | null
  searchEngine: SearchEngine
  searchSuggestionsEnabled: boolean
  onCustomSearchSave: (url: string) => boolean
  onForceDarkWebsitesChange: (enabled: boolean) => void
  onSearchEngineChange: (searchEngine: SearchEngine) => void
  onSearchSuggestionsChange: (enabled: boolean) => void
  onLanguageChange: (language: string) => void
  onResetTabs: () => void
}

export function General ({
  customSearchUrl,
  forceDarkWebsites,
  persistenceError,
  searchEngine,
  searchSuggestionsEnabled,
  language,
  onCustomSearchSave,
  onForceDarkWebsitesChange,
  onSearchEngineChange,
  onSearchSuggestionsChange,
  onLanguageChange,
  onResetTabs
}: GeneralProps) {
  const isDark = useSettingsDarkMode()
  const [draftUrl, setDraftUrl] = useState(customSearchUrl)
  const [selectedEngine, setSelectedEngine] = useState(searchEngine)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [defaultBrowserError, setDefaultBrowserError] = useState<string | null>(null)

  useEffect(() => setDraftUrl(customSearchUrl), [customSearchUrl])
  useEffect(() => setSelectedEngine(searchEngine), [searchEngine])

  const normalizedDraftUrl = normalizeCustomSearchUrl(draftUrl)
  const isCustomSearchSaved = (
    searchEngine === 'custom' &&
    normalizedDraftUrl === customSearchUrl
  )
  const canSaveCustomSearch = (
    !isCustomSearchSaved &&
    (
      draftUrl.trim() !== customSearchUrl ||
      searchEngine !== 'custom'
    )
  )
  // A name typed instead of a URL: the engines it could be, to pick one.
  // Nothing once what is there is the URL already saved.
  const engineMatches = isCustomSearchSaved ? [] : findSearchEngines(draftUrl)
  const typedName = draftUrl.trim() !== '' && !normalizedDraftUrl && !/[/:%]/.test(draftUrl)
  const savedEngine = searchEngine === 'custom' ? searchEngineForUrl(customSearchUrl) : null
  // The engines open under the field, where the keyboard is, so the page
  // moves up to show the field and them together.
  const reveal = useSettingsReveal()
  const customSearchRef = useRef<View>(null)
  const hasEngineMatches = engineMatches.length > 0
  useEffect(() => {
    if (hasEngineMatches) reveal(customSearchRef.current)
  }, [hasEngineMatches, reveal])

  function selectSearchEngine (nextSearchEngine: SearchEngine) {
    setSelectedEngine(nextSearchEngine)
    setValidationError(null)
    if (nextSearchEngine !== 'custom') onSearchEngineChange(nextSearchEngine)
  }

  function saveCustomSearchUrl () {
    const normalizedUrl = normalizeCustomSearchUrl(draftUrl)
    // A name and Save: the best fit, the first one listed.
    if (!normalizedUrl && engineMatches.length > 0) {
      pickSearchEngine(engineMatches[0].url)
      return
    }
    if (!normalizedUrl) {
      setValidationError(t('Enter a valid HTTPS search URL, for example {example}', {
        example: `https://www.ecosia.org/search?q=${CUSTOM_SEARCH_QUERY_PLACEHOLDER}`
      }))
      return
    }

    if (!onCustomSearchSave(normalizedUrl)) return
    setDraftUrl(normalizedUrl)
    setValidationError(null)
  }

  function pickSearchEngine (url: string) {
    Keyboard.dismiss()
    setDraftUrl(url)
    setValidationError(null)
    onCustomSearchSave(url)
  }

  async function openDefaultBrowserSettings () {
    setDefaultBrowserError(null)
    try {
      await Linking.sendIntent('android.settings.MANAGE_DEFAULT_APPS_SETTINGS')
    } catch {
      setDefaultBrowserError(t('Unable to open default browser settings.'))
    }
  }

  function confirmResetTabs () {
    Alert.alert(
      t('Reset tab session?'),
      t('This will close every open tab and return to the home page.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Reset'), style: 'destructive', onPress: onResetTabs }
      ]
    )
  }

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {persistenceError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError}</Text>
        </View>
      )}

      {/* Which app opens a web link is a preference, not a permission: it
          grants nothing and revokes nothing. It sat under Permissions, where
          nobody looking for it would think to check. */}
      {Platform.OS === 'android' && (
        <SettingsSection title={t('Default browser')}>
          <View style={styles.settingRow}>
            <SettingCopy
              title={t('Open web links with PeerSky')}
              description={t('Choose PeerSky as the app that opens web links.')}
            />
            <Pressable
              accessibilityRole='button'
              style={({ pressed }) => [styles.saveButton, pressed ? styles.saveButtonDisabled : null]}
              onPress={() => void openDefaultBrowserSettings()}
            >
              <Text style={styles.saveButtonText}>{t('Choose')}</Text>
            </Pressable>
          </View>
          {defaultBrowserError && <Text style={styles.validationError}>{defaultBrowserError}</Text>}
        </SettingsSection>
      )}

      {/* Off by default. Inverting a page is a blunt instrument and plenty of
          sites now ship their own dark theme, so this is for the ones that
          never did rather than something to leave on and forget. */}
      <SettingsSection title={t('Dark websites')}>
        <View style={styles.settingRow}>
          <SettingCopy
            title={t('Force dark mode')}
            description={t('Darken sites that have no dark theme of their own. Sites that are already dark are left as they are.')}
          />
          <Switch
            accessibilityLabel={t('Force dark mode on websites')}
            value={forceDarkWebsites}
            onValueChange={onForceDarkWebsitesChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={forceDarkWebsites ? '#1f6fd1' : '#ffffff'}
          />
        </View>
      </SettingsSection>

      <SettingsSection title={t('Search engine')}>
        <ChoiceGroup
          options={SEARCH_ENGINES.map((engine) => ({ id: engine.id, title: tKey(engine.title) }))}
          selected={selectedEngine}
          onSelect={selectSearchEngine}
        />
        {selectedEngine === 'custom' && (
          <View ref={customSearchRef} style={[styles.customSearch, isDark ? styles.customSearchDark : null]}>
            <Text style={[styles.label, isDark ? styles.primaryTextDark : null]}>
              {t('Name or search URL')}
            </Text>
            <Text style={[styles.description, isDark ? styles.secondaryTextDark : null]}>
              {t("Type a search engine's name and pick it, or enter its search URL with {placeholder} where the search text goes.", { placeholder: CUSTOM_SEARCH_QUERY_PLACEHOLDER })}
            </Text>
            {/* Not the URL keyboard: it has no space bar, and most people
                type a name here now. */}
            <TextInput
              autoCapitalize='none'
              autoCorrect={false}
              placeholder='Brave, Qwant, Mojeek'
              placeholderTextColor={isDark ? '#7f8ba3' : '#8190a7'}
              style={[styles.input, isDark ? styles.inputDark : null]}
              value={draftUrl}
              onChangeText={(value) => {
                setDraftUrl(value)
                if (validationError) setValidationError(null)
              }}
            />
            {engineMatches.length > 0 && (
              <View style={styles.engineMatches}>
                {engineMatches.map((engine, index) => (
                  <Pressable
                    accessibilityRole='button'
                    key={engine.url}
                    onPress={() => pickSearchEngine(engine.url)}
                    style={({ pressed }) => [
                      styles.engineMatch,
                      isDark ? styles.engineMatchDark : null,
                      index === engineMatches.length - 1 ? styles.engineMatchLast : null,
                      pressed ? styles.pressed : null
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.engineName, isDark ? styles.primaryTextDark : null]}>
                      {engine.name}
                    </Text>
                    <Text numberOfLines={1} style={[styles.engineHost, isDark ? styles.secondaryTextDark : null]}>
                      {engine.host}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {typedName && engineMatches.length === 0 && !validationError && (
              <Text style={[styles.fallback, isDark ? styles.secondaryTextDark : null]}>
                {t('No search engine by that name. Enter its search URL instead.')}
              </Text>
            )}
            {isCustomSearchSaved && savedEngine && (
              <Text style={[styles.fallback, isDark ? styles.secondaryTextDark : null]}>
                {t('Searching with {name}', { name: savedEngine.name })}
              </Text>
            )}
            {validationError && <Text style={styles.validationError}>{validationError}</Text>}
            {!customSearchUrl && !validationError && (
              <Text style={[styles.fallback, isDark ? styles.secondaryTextDark : null]}>
                {t('DuckDuckGo is used until a valid custom URL is saved.')}
              </Text>
            )}
            <Pressable
              accessibilityRole='button'
              accessibilityState={{ disabled: !canSaveCustomSearch }}
              disabled={!canSaveCustomSearch}
              style={({ pressed }) => [
                styles.saveButton,
                !canSaveCustomSearch ? styles.saveButtonDisabled : null,
                pressed ? styles.pressed : null
              ]}
              onPress={saveCustomSearchUrl}
            >
              <Text style={styles.saveButtonText}>
                {isCustomSearchSaved ? t('Saved') : t('Save')}
              </Text>
            </Pressable>
          </View>
        )}
        {/* On, like the link previews in PeerChat: the engine is the one you
            search with anyway, it is asked without cookies, and never from an
            incognito tab. */}
        <View style={[styles.settingRow, styles.suggestionsRow, isDark ? styles.customSearchDark : null]}>
          <SettingCopy
            title={t('Search suggestions')}
            description={searchEngine === 'custom'
              ? t('A custom engine has no suggestions to show.')
              : t('Searches from your search engine as you type. Never in incognito tabs, and never for addresses.')}
          />
          <Switch
            accessibilityLabel={t('Search suggestions')}
            value={searchSuggestionsEnabled}
            onValueChange={onSearchSuggestionsChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={searchSuggestionsEnabled ? '#1f6fd1' : '#ffffff'}
          />
        </View>
      </SettingsSection>

      <SettingsSection title={t('Tabs')}>
        <Pressable style={styles.actionRow} onPress={confirmResetTabs}>
          <SettingCopy
            title={t('Reset tab session')}
            description={t('Close all saved tabs and open a fresh home tab.')}
          />
          <Text style={styles.destructiveAction}>{t('Reset')}</Text>
        </Pressable>
      </SettingsSection>

      <LanguageSection language={language} onLanguageChange={onLanguageChange} />
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1
  },
  pageDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16
  },
  customSearch: {
    borderTopColor: '#e6ecf5',
    borderTopWidth: 1,
    gap: 8,
    padding: 16
  },
  customSearchDark: {
    borderTopColor: '#343949'
  },
  engineMatches: {
    borderColor: '#cad3e1',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden'
  },
  engineMatch: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#e6ecf5',
    borderBottomWidth: 1,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  engineMatchDark: {
    backgroundColor: '#202531',
    borderBottomColor: '#343949'
  },
  engineMatchLast: {
    borderBottomWidth: 0
  },
  engineName: {
    color: '#1f2a44',
    fontSize: 15,
    fontWeight: '600'
  },
  engineHost: {
    color: '#687086',
    fontSize: 12
  },
  suggestionsRow: {
    borderTopColor: '#e6ecf5',
    borderTopWidth: 1
  },
  label: {
    color: '#1f2a44',
    fontSize: 15,
    fontWeight: '700'
  },
  description: {
    color: '#687086',
    fontSize: 13,
    lineHeight: 18
  },
  input: {
    backgroundColor: '#f7f9fc',
    borderColor: '#cad3e1',
    borderRadius: 10,
    borderWidth: 1,
    color: '#151821',
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  inputDark: {
    backgroundColor: '#202531',
    borderColor: '#454c60',
    color: '#f2f5fb'
  },
  primaryTextDark: {
    color: '#f2f5fb'
  },
  secondaryTextDark: {
    color: '#aab4c8'
  },
  fallback: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17
  },
  validationError: {
    color: '#b3334d',
    fontSize: 12,
    lineHeight: 17
  },
  saveButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#1f6fd1',
    borderRadius: 10,
    minWidth: 88,
    paddingHorizontal: 18,
    paddingVertical: 11
  },
  saveButtonDisabled: {
    opacity: 0.55
  },
  saveButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800'
  },
  pressed: {
    opacity: 0.7
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16
  },
  destructiveAction: {
    color: '#a7354a',
    fontSize: 14,
    fontWeight: '800'
  },
  errorBanner: {
    backgroundColor: '#fff1f3',
    borderBottomColor: '#efb8c2',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  errorText: {
    color: '#8f2940',
    fontSize: 13,
    lineHeight: 18
  }
})
