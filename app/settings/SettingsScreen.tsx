import Constants from 'expo-constants'
import { useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { Appearance } from './Appearance'
import { Accessibility } from './Accessibility'
import { DataClearing } from './DataClearing'
import { General } from './General'
import { Permissions } from './Permissions'
import {
  SettingCopy,
  SettingsSection,
  SettingsThemeProvider,
  useSettingsDarkMode
} from './SettingsUI'
import type {
  AddressBarPosition,
  BrowserTheme,
  ExternalLinkBehavior,
  SearchEngine,
  WebsiteTextScale
} from './useBrowserPreferences'

type SettingsPage =
  | 'main'
  | 'general'
  | 'accessibility'
  | 'appearance'
  | 'data-clearing'
  | 'permissions'
  | 'about'

type SettingsScreenProps = {
  addressBarPosition: AddressBarPosition
  customSearchUrl: string
  enforceManualPageZoom: boolean
  externalLinkBehavior: ExternalLinkBehavior
  isDark: boolean
  persistenceError: string | null
  restoreTabsOnStartup: boolean
  searchEngine: SearchEngine
  showFullAddress: boolean
  theme: BrowserTheme
  websiteTextScale: WebsiteTextScale
  onAddressBarPositionChange: (position: AddressBarPosition) => void
  onClose: () => void
  onClearBrowsingData: () => boolean
  onClearCachedData: () => boolean
  onCustomSearchSave: (url: string) => boolean
  onEnforceManualPageZoomChange: (enabled: boolean) => void
  onExternalLinkBehaviorChange: (behavior: ExternalLinkBehavior) => void
  onRestoreTabsOnStartupChange: (enabled: boolean) => void
  onSearchEngineChange: (searchEngine: SearchEngine) => void
  onShowFullAddressChange: (enabled: boolean) => void
  onThemeChange: (theme: BrowserTheme) => void
  onWebsiteTextScaleChange: (scale: WebsiteTextScale) => void
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
    description: 'External app link handling'
  },
  {
    id: 'about',
    title: 'About',
    description: 'Version, source code, and licenses'
  }
]

export function SettingsScreen (props: SettingsScreenProps) {
  const [page, setPage] = useState<SettingsPage>('main')
  let content

  if (page === 'main') {
    content = <SettingsHome onClose={props.onClose} onOpenPage={setPage} />
  } else {
    content = (
      <SettingsSubpage title={getSettingsPageTitle(page)} onBack={() => setPage('main')}>
        {page === 'general' && <General {...props} />}
        {page === 'accessibility' && <Accessibility {...props} />}
        {page === 'appearance' && <Appearance {...props} />}
        {page === 'data-clearing' && <DataClearing {...props} />}
        {page === 'permissions' && <Permissions {...props} />}
        {page === 'about' && <AboutSettings onOpenUrl={props.onOpenUrl} />}
      </SettingsSubpage>
    )
  }

  return (
    <SettingsThemeProvider value={props.isDark}>
      {content}
    </SettingsThemeProvider>
  )
}

function SettingsHome ({
  onClose,
  onOpenPage
}: {
  onClose: () => void
  onOpenPage: (page: SettingsPage) => void
}) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.screen, isDark ? darkStyles.screen : null]}>
      <View style={[styles.homeHeader, isDark ? darkStyles.header : null]}>
        <Pressable
          accessibilityLabel='Close Settings'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed ? styles.rowPressed : null]}
          onPress={onClose}
        >
          <Text style={[styles.backButtonText, isDark ? darkStyles.primaryText : null]}>{'<'}</Text>
        </Pressable>
        <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>Settings</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.menu, isDark ? darkStyles.surface : null]}>
          {SETTINGS_PAGES.map((page, index) => (
            <Pressable
              key={page.id}
              accessibilityRole='button'
              style={({ pressed }) => [
                styles.menuRow,
                index > 0 ? styles.rowDivider : null,
                index > 0 && isDark ? darkStyles.divider : null,
                pressed ? styles.rowPressed : null
              ]}
              onPress={() => onOpenPage(page.id)}
            >
              <SettingCopy title={page.title} description={page.description} />
              <Text style={[styles.chevron, isDark ? darkStyles.secondaryText : null]}>{'>'}</Text>
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
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.screen, isDark ? darkStyles.screen : null]}>
      <View style={[styles.subpageHeader, isDark ? darkStyles.header : null]}>
        <Pressable
          accessibilityLabel='Back to Settings'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.backButton, pressed ? styles.rowPressed : null]}
          onPress={onBack}
        >
          <Text style={[styles.backButtonText, isDark ? darkStyles.primaryText : null]}>{'<'}</Text>
        </Pressable>
        <Text style={[styles.subpageTitle, isDark ? darkStyles.primaryText : null]}>{title}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {children}
      </ScrollView>
    </View>
  )
}

function AboutSettings ({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.pageContent, isDark ? darkStyles.page : null]}>
      <SettingsSection title='PeerSky Mobile'>
        <View style={styles.aboutRow}>
          <SettingCopy
            title='PeerSky Browser'
            description={`Version ${Constants.expoConfig?.version || 'unknown'}`}
          />
        </View>
        <Pressable style={styles.linkRow} onPress={() => onOpenUrl(REPOSITORY_URL)}>
          <Text style={[styles.linkText, isDark ? darkStyles.primaryText : null]}>Source code</Text>
          <Text style={[styles.chevron, isDark ? darkStyles.secondaryText : null]}>{'>'}</Text>
        </Pressable>
        <Pressable style={styles.linkRow} onPress={() => onOpenUrl(LICENSE_URL)}>
          <Text style={[styles.linkText, isDark ? darkStyles.primaryText : null]}>Open-source licenses</Text>
          <Text style={[styles.chevron, isDark ? darkStyles.secondaryText : null]}>{'>'}</Text>
        </Pressable>
      </SettingsSection>
    </View>
  )
}

function SectionPlaceholder ({ description }: { description: string }) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.placeholder, isDark ? darkStyles.surface : null]}>
      <Text style={[styles.placeholderTitle, isDark ? darkStyles.primaryText : null]}>Coming in the next step</Text>
      <Text style={[styles.placeholderDescription, isDark ? darkStyles.secondaryText : null]}>{description}</Text>
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
  }
})

const darkStyles = StyleSheet.create({
  screen: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  page: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  surface: {
    backgroundColor: BROWSER_PALETTES.dark.surface
  },
  header: {
    backgroundColor: BROWSER_PALETTES.dark.surface,
    borderBottomColor: BROWSER_PALETTES.dark.border
  },
  divider: {
    borderTopColor: BROWSER_PALETTES.dark.border
  },
  primaryText: {
    color: BROWSER_PALETTES.dark.text
  },
  secondaryText: {
    color: BROWSER_PALETTES.dark.mutedText
  }
})
