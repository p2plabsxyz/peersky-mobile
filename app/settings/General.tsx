import { useEffect, useState } from 'react'
import {
  Alert,
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
import { SEARCH_ENGINES } from './browser-preferences.mjs'
import {
  ChoiceGroup,
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'
import type { SearchEngine } from './useBrowserPreferences'

type GeneralProps = {
  customSearchUrl: string
  persistenceError: string | null
  restoreTabsOnStartup: boolean
  searchEngine: SearchEngine
  onCustomSearchSave: (url: string) => boolean
  onRestoreTabsOnStartupChange: (enabled: boolean) => void
  onSearchEngineChange: (searchEngine: SearchEngine) => void
  onResetTabs: () => void
}

export function General ({
  customSearchUrl,
  persistenceError,
  restoreTabsOnStartup,
  searchEngine,
  onCustomSearchSave,
  onRestoreTabsOnStartupChange,
  onSearchEngineChange,
  onResetTabs
}: GeneralProps) {
  const isDark = useSettingsDarkMode()
  const [draftUrl, setDraftUrl] = useState(customSearchUrl)
  const [selectedEngine, setSelectedEngine] = useState(searchEngine)
  const [validationError, setValidationError] = useState<string | null>(null)

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

  function selectSearchEngine (nextSearchEngine: SearchEngine) {
    setSelectedEngine(nextSearchEngine)
    setValidationError(null)
    if (nextSearchEngine !== 'custom') onSearchEngineChange(nextSearchEngine)
  }

  function saveCustomSearchUrl () {
    const normalizedUrl = normalizeCustomSearchUrl(draftUrl)
    if (!normalizedUrl) {
      setValidationError(
        `Enter a valid HTTPS search URL, for example https://www.ecosia.org/search?q=${CUSTOM_SEARCH_QUERY_PLACEHOLDER}`
      )
      return
    }

    if (!onCustomSearchSave(normalizedUrl)) return
    setDraftUrl(normalizedUrl)
    setValidationError(null)
  }

  function confirmResetTabs () {
    Alert.alert(
      'Reset tab session?',
      'This will close every open tab and return to the home page.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: onResetTabs }
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

      <SettingsSection title='Startup'>
        <View style={styles.settingRow}>
          <SettingCopy
            title='Restore previous tabs'
            description='Continue with your open tabs when PeerSky starts.'
          />
          <Switch
            accessibilityLabel='Restore previous tabs on startup'
            value={restoreTabsOnStartup}
            onValueChange={onRestoreTabsOnStartupChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={restoreTabsOnStartup ? '#1f6fd1' : '#ffffff'}
          />
        </View>
      </SettingsSection>

      <SettingsSection title='Search engine'>
        <ChoiceGroup
          options={SEARCH_ENGINES}
          selected={selectedEngine}
          onSelect={selectSearchEngine}
        />
        {selectedEngine === 'custom' && (
          <View style={[styles.customSearch, isDark ? styles.customSearchDark : null]}>
            <Text style={[styles.label, isDark ? styles.primaryTextDark : null]}>
              Search URL
            </Text>
            <Text style={[styles.description, isDark ? styles.secondaryTextDark : null]}>
              Use {CUSTOM_SEARCH_QUERY_PLACEHOLDER} where the search text should appear.
            </Text>
            <TextInput
              autoCapitalize='none'
              autoCorrect={false}
              keyboardType='url'
              placeholder={`https://example.com/search?q=${CUSTOM_SEARCH_QUERY_PLACEHOLDER}`}
              placeholderTextColor={isDark ? '#7f8ba3' : '#8190a7'}
              style={[styles.input, isDark ? styles.inputDark : null]}
              value={draftUrl}
              onChangeText={(value) => {
                setDraftUrl(value)
                if (validationError) setValidationError(null)
              }}
            />
            {validationError && <Text style={styles.validationError}>{validationError}</Text>}
            {!customSearchUrl && !validationError && (
              <Text style={[styles.fallback, isDark ? styles.secondaryTextDark : null]}>
                DuckDuckGo is used until a valid custom URL is saved.
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
                {isCustomSearchSaved ? 'Saved' : 'Save'}
              </Text>
            </Pressable>
          </View>
        )}
      </SettingsSection>

      <SettingsSection title='Tabs'>
        <Pressable style={styles.actionRow} onPress={confirmResetTabs}>
          <SettingCopy
            title='Reset tab session'
            description='Close all saved tabs and open a fresh home tab.'
          />
          <Text style={styles.destructiveAction}>Reset</Text>
        </Pressable>
      </SettingsSection>
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
