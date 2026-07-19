import Constants from 'expo-constants'
import { useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native'
import { SEARCH_ENGINES } from './browser-preferences.mjs'
import type { SearchEngine } from './useBrowserPreferences'

type SettingsPage =
  | 'main'
  | 'general'
  | 'accessibility'
  | 'appearance'
  | 'data-clearing'
  | 'permissions'
  | 'about'

type SettingsScreenProps = {
  persistenceError: string | null
  restoreTabsOnStartup: boolean
  searchEngine: SearchEngine
  onClose: () => void
  onRestoreTabsOnStartupChange: (enabled: boolean) => void
  onSearchEngineChange: (searchEngine: SearchEngine) => void
  onResetTabs: () => void
  onOpenUrl: (url: string) => void
}

const REPOSITORY_URL = 'https://github.com/p2plabsxyz/peersky-mobile'
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`

const SETTINGS_PAGES: Array<{
  id: Exclude<SettingsPage, 'main'>
  title: string
  description: string
}> = [
  {
    id: 'general',
    title: 'General',
    description: 'Search and startup behavior'
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    description: 'Text size and page zoom'
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Theme and address bar layout'
  },
  {
    id: 'data-clearing',
    title: 'Data Clearing',
    description: 'Tabs and browsing data'
  },
  {
    id: 'permissions',
    title: 'Permissions',
    description: 'Site and external-link permissions'
  },
  {
    id: 'about',
    title: 'About',
    description: 'Version, source code, and licenses'
  }
]

export function SettingsScreen (props: SettingsScreenProps) {
  const [page, setPage] = useState<SettingsPage>('main')

  if (page === 'main') {
    return <SettingsHome onClose={props.onClose} onOpenPage={setPage} />
  }

  return (
    <SettingsSubpage title={getSettingsPageTitle(page)} onBack={() => setPage('main')}>
      {page === 'general' && <GeneralSettings {...props} />}
      {page === 'accessibility' && (
        <SectionPlaceholder description='Website text size and manual page zoom will be added next.' />
      )}
      {page === 'appearance' && (
        <SectionPlaceholder description='Theme and address bar preferences will be added next.' />
      )}
      {page === 'data-clearing' && (
        <SectionPlaceholder description='Browsing-data controls will be added in the Data Clearing step.' />
      )}
      {page === 'permissions' && (
        <SectionPlaceholder description='Site and external-link controls will be added in the Permissions step.' />
      )}
      {page === 'about' && <AboutSettings onOpenUrl={props.onOpenUrl} />}
    </SettingsSubpage>
  )
}

function SettingsHome ({
  onClose,
  onOpenPage
}: {
  onClose: () => void
  onOpenPage: (page: SettingsPage) => void
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.homeHeader}>
        <Pressable
          accessibilityLabel='Close Settings'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed ? styles.rowPressed : null]}
          onPress={onClose}
        >
          <Text style={styles.backButtonText}>{'<'}</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.menu}>
          {SETTINGS_PAGES.map((page, index) => (
            <Pressable
              key={page.id}
              accessibilityRole='button'
              style={({ pressed }) => [
                styles.menuRow,
                index > 0 ? styles.rowDivider : null,
                pressed ? styles.rowPressed : null
              ]}
              onPress={() => onOpenPage(page.id)}
            >
              <SettingCopy title={page.title} description={page.description} />
              <Text style={styles.chevron}>{'>'}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

function SettingsSubpage ({
  title,
  onBack,
  children
}: {
  title: string
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.subpageHeader}>
        <Pressable
          accessibilityLabel='Back to Settings'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed ? styles.rowPressed : null]}
          onPress={onBack}
        >
          <Text style={styles.backButtonText}>{'<'}</Text>
        </Pressable>
        <Text style={styles.subpageTitle}>{title}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {children}
      </ScrollView>
    </View>
  )
}

function GeneralSettings ({
  persistenceError,
  restoreTabsOnStartup,
  searchEngine,
  onRestoreTabsOnStartupChange,
  onSearchEngineChange,
  onResetTabs
}: SettingsScreenProps) {
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
    <View style={styles.pageContent}>
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
        <View style={styles.choiceGroup}>
          {SEARCH_ENGINES.map((engine) => {
            const selected = engine.id === searchEngine

            return (
              <Pressable
                key={engine.id}
                accessibilityRole='radio'
                accessibilityState={{ selected }}
                style={[styles.choice, selected ? styles.choiceSelected : null]}
                onPress={() => onSearchEngineChange(engine.id as SearchEngine)}
              >
                <Text style={[styles.choiceText, selected ? styles.choiceTextSelected : null]}>
                  {engine.title}
                </Text>
                <View style={[styles.radio, selected ? styles.radioSelected : null]}>
                  {selected && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            )
          })}
        </View>
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

function AboutSettings ({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  return (
    <View style={styles.pageContent}>
      <SettingsSection title='PeerSky Mobile'>
        <View style={styles.aboutRow}>
          <SettingCopy
            title='PeerSky Browser'
            description={`Version ${Constants.expoConfig?.version || 'unknown'}`}
          />
        </View>
        <Pressable style={styles.linkRow} onPress={() => onOpenUrl(REPOSITORY_URL)}>
          <Text style={styles.linkText}>Source code</Text>
          <Text style={styles.chevron}>{'>'}</Text>
        </Pressable>
        <Pressable style={styles.linkRow} onPress={() => onOpenUrl(LICENSE_URL)}>
          <Text style={styles.linkText}>Open-source licenses</Text>
          <Text style={styles.chevron}>{'>'}</Text>
        </Pressable>
      </SettingsSection>
    </View>
  )
}

function SectionPlaceholder ({ description }: { description: string }) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>Coming in the next step</Text>
      <Text style={styles.placeholderDescription}>{description}</Text>
    </View>
  )
}

function SettingsSection ({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  )
}

function SettingCopy ({
  title,
  description
}: {
  title: string
  description: string
}) {
  return (
    <View style={styles.settingCopy}>
      <Text style={styles.settingTitle}>{title}</Text>
      <Text style={styles.settingDescription}>{description}</Text>
    </View>
  )
}

function getSettingsPageTitle (page: Exclude<SettingsPage, 'main'>) {
  return SETTINGS_PAGES.find((entry) => entry.id === page)?.title || 'Settings'
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#ffffff',
    flex: 1
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1
  },
  homeHeader: {
    alignItems: 'center',
    borderBottomColor: '#dbe3ef',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 9
  },
  title: {
    color: '#151821',
    fontSize: 23,
    fontWeight: '800'
  },
  menu: {
    backgroundColor: '#ffffff',
    overflow: 'hidden'
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    paddingHorizontal: 20,
    paddingVertical: 14
  },
  rowDivider: {
    borderTopColor: '#e7ebf1',
    borderTopWidth: 1
  },
  rowPressed: {
    opacity: 0.65
  },
  chevron: {
    color: '#8190a7',
    fontSize: 19,
    fontWeight: '700'
  },
  subpageHeader: {
    alignItems: 'center',
    borderBottomColor: '#dbe3ef',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 12
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  backButtonText: {
    color: '#1f2a44',
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 30
  },
  subpageTitle: {
    color: '#151821',
    fontSize: 20,
    fontWeight: '800'
  },
  pageContent: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1
  },
  section: {
    backgroundColor: '#ffffff'
  },
  sectionTitle: {
    backgroundColor: '#f5f8fc',
    color: '#687086',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingBottom: 9,
    paddingHorizontal: 20,
    paddingTop: 22,
    textTransform: 'uppercase'
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#e1e7f0',
    borderBottomWidth: 1,
    borderTopColor: '#e1e7f0',
    borderTopWidth: 1,
    overflow: 'hidden'
  },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16
  },
  settingCopy: {
    flex: 1,
    gap: 4
  },
  settingTitle: {
    color: '#1f2a44',
    fontSize: 15,
    fontWeight: '700'
  },
  settingDescription: {
    color: '#687086',
    fontSize: 13,
    lineHeight: 18
  },
  choiceGroup: {
    padding: 6
  },
  choice: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: 12
  },
  choiceSelected: {
    backgroundColor: '#edf5ff'
  },
  choiceText: {
    color: '#384158',
    fontSize: 14,
    fontWeight: '600'
  },
  choiceTextSelected: {
    color: '#1f6fd1'
  },
  radio: {
    alignItems: 'center',
    borderColor: '#9aa7ba',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20
  },
  radioSelected: {
    borderColor: '#1f6fd1'
  },
  radioDot: {
    backgroundColor: '#1f6fd1',
    borderRadius: 5,
    height: 10,
    width: 10
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
  aboutRow: {
    padding: 16
  },
  linkRow: {
    alignItems: 'center',
    borderTopColor: '#e6ecf5',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 16
  },
  linkText: {
    color: '#1f2a44',
    fontSize: 14,
    fontWeight: '600'
  },
  placeholder: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#e1e7f0',
    borderBottomWidth: 1,
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 22
  },
  placeholderTitle: {
    color: '#1f2a44',
    fontSize: 16,
    fontWeight: '800'
  },
  placeholderDescription: {
    color: '#687086',
    fontSize: 14,
    lineHeight: 20
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
