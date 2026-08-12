import Constants from 'expo-constants'
import {
  type ComponentType,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import type { SvgProps } from 'react-native-svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { Appearance } from './Appearance'
import { Accessibility } from './Accessibility'
import { DataClearing } from './DataClearing'
import { General } from './General'
import { Permissions } from './Permissions'
import { Privacy } from './Privacy'
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
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import InfoIcon from '../../assets/icons/bootstrap/info-circle.svg'
import PaletteIcon from '../../assets/icons/bootstrap/palette.svg'
import ShieldLockIcon from '../../assets/icons/bootstrap/shield-lock.svg'
import SlidersIcon from '../../assets/icons/bootstrap/sliders.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import UniversalAccessIcon from '../../assets/icons/bootstrap/universal-access-circle.svg'

type SettingsPage =
  | 'main'
  | 'general'
  | 'accessibility'
  | 'appearance'
  | 'data-clearing'
  | 'privacy'
  | 'permissions'
  | 'about'

type SettingsScreenProps = {
  addressBarPosition: AddressBarPosition
  contentBlockingEnabled: boolean
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
  onContentBlockingEnabledChange: (enabled: boolean) => Promise<void>
  onClose: () => void
  onClearBrowsingData: () => boolean
  onClearCachedData: () => boolean
  onCustomSearchSave: (url: string) => boolean
  onEnforceManualPageZoomChange: (enabled: boolean) => void
  onExternalLinkBehaviorChange: (behavior: ExternalLinkBehavior) => void
  onFilterListsUpdated: () => void
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
  icon: ComponentType<SvgProps>
}> = [
  {
    id: 'general',
    title: 'General',
    description: 'Search and startup behavior',
    icon: SlidersIcon
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    description: 'Text size and page zoom',
    icon: UniversalAccessIcon
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Theme and address bar layout',
    icon: PaletteIcon
  },
  {
    id: 'data-clearing',
    title: 'Data Clearing',
    description: 'Tabs and browsing data',
    icon: TrashIcon
  },
  {
    id: 'privacy',
    title: 'Privacy',
    description: 'Ad and tracker protection',
    icon: ShieldLockIcon
  },
  {
    id: 'permissions',
    title: 'Permissions',
    description: 'External app link handling',
    icon: ShieldLockIcon
  },
  {
    id: 'about',
    title: 'About',
    description: 'Version, source code, and licenses',
    icon: InfoIcon
  }
]

export function SettingsScreen (props: SettingsScreenProps) {
  const [page, setPage] = useState<SettingsPage>('main')
  const [transitionDirection, setTransitionDirection] = useState(1)
  const reduceMotion = useReducedMotion()
  const transition = useRef(new Animated.Value(1)).current
  let content

  if (page === 'main') {
    content = (
      <SettingsHome
        onClose={props.onClose}
        onOpenPage={(nextPage) => changePage(nextPage, 1)}
      />
    )
  } else {
    content = (
      <SettingsSubpage
        title={getSettingsPageTitle(page)}
        onBack={() => changePage('main', -1)}
      >
        {page === 'general' && <General {...props} />}
        {page === 'accessibility' && <Accessibility {...props} />}
        {page === 'appearance' && <Appearance {...props} />}
        {page === 'data-clearing' && <DataClearing {...props} />}
        {page === 'privacy' && <Privacy {...props} />}
        {page === 'permissions' && <Permissions {...props} />}
        {page === 'about' && <AboutSettings onOpenUrl={props.onOpenUrl} />}
      </SettingsSubpage>
    )
  }

  useEffect(() => {
    if (reduceMotion) {
      transition.setValue(1)
      return
    }

    const animation = Animated.timing(transition, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true
    })
    animation.start()
    return () => animation.stop()
  }, [page, reduceMotion, transition])

  function changePage (nextPage: SettingsPage, direction: number) {
    if (nextPage === page) return

    transition.stopAnimation()
    transition.setValue(reduceMotion ? 1 : 0)
    setTransitionDirection(direction)
    setPage(nextPage)
  }

  const transitionStyle = reduceMotion
    ? null
    : {
        opacity: transition,
        transform: [{
          translateX: transition.interpolate({
            inputRange: [0, 1],
            outputRange: [12 * transitionDirection, 0]
          })
        }]
      }

  return (
    <SettingsThemeProvider value={props.isDark}>
      <Animated.View style={[styles.transition, transitionStyle]}>
        {content}
      </Animated.View>
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
          <ArrowLeftIcon
            width={22}
            height={22}
            color={isDark ? BROWSER_PALETTES.dark.text : '#1f2a44'}
          />
        </Pressable>
        <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>Settings</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.menu, isDark ? darkStyles.surface : null]}>
          {SETTINGS_PAGES.map((page, index) => {
            const Icon = page.icon

            return (
              <Pressable
                key={page.id}
                accessibilityLabel={`${page.title}. ${page.description}`}
                accessibilityRole='button'
                style={({ pressed }) => [
                  styles.menuRow,
                  index > 0 ? styles.rowDivider : null,
                  index > 0 && isDark ? darkStyles.divider : null,
                  pressed ? styles.rowPressed : null
                ]}
                onPress={() => onOpenPage(page.id)}
              >
                <View style={[
                  styles.menuIcon,
                  isDark ? darkStyles.menuIcon : null
                ]}>
                  <Icon
                    width={22}
                    height={22}
                    color={isDark ? '#8fc1ff' : '#1f6fd1'}
                  />
                </View>
                <SettingCopy
                  title={page.title}
                  description={page.description}
                  prominent
                />
                <ChevronRightIcon
                  width={16}
                  height={16}
                  color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
                />
              </Pressable>
            )
          })}
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
          <ArrowLeftIcon
            width={22}
            height={22}
            color={isDark ? BROWSER_PALETTES.dark.text : '#1f2a44'}
          />
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
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
        <Pressable style={styles.linkRow} onPress={() => onOpenUrl(LICENSE_URL)}>
          <Text style={[styles.linkText, isDark ? darkStyles.primaryText : null]}>Open-source licenses</Text>
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
      </SettingsSection>
    </View>
  )
}

function getSettingsPageTitle (page: Exclude<SettingsPage, 'main'>) {
  return SETTINGS_PAGES.find((entry) => entry.id === page)?.title || 'Settings'
}

function useReducedMotion () {
  const [reduceMotion, setReduceMotion] = useState(true)

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled)
      })
      .catch((error) => {
        console.warn('Failed reading reduced-motion preference:', error)
      })
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    )

    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  return reduceMotion
}

const styles = StyleSheet.create({
  transition: {
    flex: 1
  },
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
    minHeight: 56,
    paddingHorizontal: 12
  },
  title: {
    color: '#151821',
    fontSize: 20,
    fontWeight: '800'
  },
  menu: {
    backgroundColor: '#ffffff',
    overflow: 'hidden'
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 13,
    minHeight: 74,
    paddingHorizontal: 16,
    paddingVertical: 11
  },
  menuIcon: {
    alignItems: 'center',
    backgroundColor: '#edf5ff',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  rowDivider: {
    borderTopColor: '#e7ebf1',
    borderTopWidth: 1
  },
  rowPressed: {
    opacity: 0.65
  },
  subpageHeader: {
    alignItems: 'center',
    borderBottomColor: '#dbe3ef',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 12
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  subpageTitle: {
    color: '#151821',
    fontSize: 18,
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
  menuIcon: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
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
