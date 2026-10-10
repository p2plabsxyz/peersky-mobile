import Constants from 'expo-constants'
import {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import type { ImageSourcePropType } from 'react-native'
import type { SvgProps } from 'react-native-svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { RPC_HYPER_LAN_STATUS } from '../../backend/rpc/commands.mjs'
import { LinkDeviceSettings } from './LinkDevice'
import { Appearance } from './Appearance'
import { ToolbarButtonSettings } from './ToolbarButton'
import { Accessibility } from './Accessibility'
import { DataClearing } from './DataClearing'
import { General } from './General'
import { Permissions } from './Permissions'
import { Privacy } from './Privacy'
import { Licenses } from './Licenses'
import { P2PStorage } from './P2PStorage'
import { SiteData } from './SiteData'
import { AddressBarButtonSettings } from './AddressBarButton'
import {
  SettingCopy,
  SettingsSection,
  SettingsThemeProvider,
  useSettingsDarkMode
} from './SettingsUI'
import type {
  AddressBarButton,
  AddressBarPosition,
  BrowserTheme,
  ExternalLinkBehavior,
  PublishingDecision,
  SearchEngine,
  ToolbarButton,
  WebsiteTextScale
} from './useBrowserPreferences'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import InfoIcon from '../../assets/icons/bootstrap/info-circle.svg'
import PaletteIcon from '../../assets/icons/bootstrap/palette.svg'
import ShieldLockIcon from '../../assets/icons/bootstrap/shield-lock.svg'
import LinkIcon from '../../assets/icons/bootstrap/link-45deg.svg'
import SlidersIcon from '../../assets/icons/bootstrap/sliders.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import UniversalAccessIcon from '../../assets/icons/bootstrap/universal-access-circle.svg'
import DisplayIcon from '../../assets/icons/bootstrap/display.svg'
import DatabaseIcon from '../../assets/icons/bootstrap/database.svg'
import { LAN_PERMISSION_HELP, LAN_PERMISSION_TITLE, offerPermissionSettings } from '../permission-prompt'

export type SettingsPage =
  | 'main'
  | 'general'
  | 'accessibility'
  | 'appearance'
  | 'data-clearing'
  | 'privacy'
  | 'p2p-storage'
  | 'permissions'
  | 'link-device'
  | 'lan-discovery'
  | 'about'
  | 'licenses'
  | 'toolbar-button'
  | 'address-bar-button'
  | 'site-data'

// Pages opened from another page, which back returns to: the licenses from
// About, the toolbar button from Appearance, and site data from Data Clearing.
const SETTINGS_PARENT_PAGES: Partial<Record<SettingsPage, SettingsPage>> = {
  licenses: 'about',
  'toolbar-button': 'appearance',
  'address-bar-button': 'appearance',
  'site-data': 'data-clearing'
}

type StorageFileItem = {
  name: string
  type: 'file' | 'dir'
  size: number
  mtime: string | null
  content?: string | null
}

type RpcResponse = {
  ok: boolean
  error?: string
  encryptionPublicKey?: string
  restoredFiles?: number
  path?: string
  files?: StorageFileItem[]
  nonce?: string
  sas?: string
  lan?: LANDiscoveryStatus
  items?: Array<{
    id: string
    title: string
    url: string
    fileCount: number
    byteLength: number
    exists?: boolean
    truncated?: boolean
  }>
  page?: number
  total?: number
  totalPages?: number
  clearedCores?: number
  cleared?: boolean
  archive?: {
    items: Array<{
      url: string
      driveUrl: string
      name: string
      source: 'published' | 'fetched'
      appId?: string
      updatedAt: number
    }>
    page: number
    total: number
    totalPages: number
  }
}

type LANDiscoveryPeer = {
  publicKey: string
  host: string
  port: number | null
  reachable: boolean
  connected: boolean
  activeConnections: number
  sharedTopics: number
  lastConnected: number | null
  lastSeen: number
}

type LANDiscoveryStatus = {
  available: boolean
  error?: string
  host?: string
  port?: number | null
  publicKey?: string
  joinedTopics: number
  activeConnections: number
  peers: LANDiscoveryPeer[]
}

type SettingsScreenProps = {
  addressBarButton: AddressBarButton
  addressBarPosition: AddressBarPosition
  appLogoColor: string
  forceDarkWebsites: boolean
  initialPage?: SettingsPage
  // Lets the back gesture and the Android button step out of a subpage the way
  // its own back arrow does, instead of closing settings from inside one.
  registerGoBack?: (handler: (() => boolean) | null) => void
  // Settings opened straight onto a page from somewhere else, so there is no
  // settings list behind it to go back to.
  closeOnBack?: boolean
  contentBlockingEnabled: boolean
  customSearchUrl: string
  downloadOnlyOnWifi: boolean
  enforceManualPageZoom: boolean
  externalLinkBehavior: ExternalLinkBehavior
  isDark: boolean
  offlineNetworkAllowed: boolean
  persistenceError: string | null
  publishingSites: Record<string, PublishingDecision>
  searchEngine: SearchEngine
  searchSuggestionsEnabled: boolean
  showFullAddress: boolean
  theme: BrowserTheme
  toolbarButton: ToolbarButton
  websiteTextScale: WebsiteTextScale
  youtubeAdBlockingEnabled: boolean
  storagePath: string
  // The sites Android is asked about in Cookies and site data.
  getSiteDataHosts: () => string[]
  onAddressBarButtonChange: (button: AddressBarButton) => void
  onAddressBarPositionChange: (position: AddressBarPosition) => void
  onAppLogoColorChange: (color: string) => void
  onForceDarkWebsitesChange: (enabled: boolean) => void
  onCallRpc: (command: number, data?: object) => Promise<RpcResponse>
  onContentBlockingEnabledChange: (enabled: boolean) => Promise<void>
  onClose: () => void
  onClearBrowsingData: () => boolean
  onClearCachedData: () => boolean
  onCustomSearchSave: (url: string) => boolean
  onDownloadOnlyOnWifiChange: (enabled: boolean) => void
  onEnforceManualPageZoomChange: (enabled: boolean) => void
  onExternalLinkBehaviorChange: (behavior: ExternalLinkBehavior) => void
  onPublishingSiteChange: (siteId: string, decision: PublishingDecision | null) => void
  onFilterListsUpdated: () => void
  onSearchEngineChange: (searchEngine: SearchEngine) => void
  onSearchSuggestionsChange: (enabled: boolean) => void
  onShowFullAddressChange: (enabled: boolean) => void
  onThemeChange: (theme: BrowserTheme) => void
  onToolbarButtonChange: (button: ToolbarButton) => void
  onWebsiteTextScaleChange: (scale: WebsiteTextScale) => void
  onYoutubeAdBlockingEnabledChange: (enabled: boolean) => void
  onResetTabs: () => void
  // P2P Data deleted P2PMD's notes; false when Recent notes could not be cleared.
  onP2pmdDataDeleted: () => boolean
  // P2P Data removed offline folders, so PeerTunes drops songs from them.
  onOfflineFoldersChanged: () => void
  onOpenUrl: (url: string, fromPage?: SettingsPage) => void
  onOpenHyperItem: (item: { name: string, source: 'fetched' | 'published', url: string }) => void
  onRestartRequired: () => void
}

const REPOSITORY_URL = 'https://github.com/p2plabsxyz/peersky-mobile'
const FEEDBACK_EMAIL = 'contact@p2plabs.xyz'

const SETTINGS_PAGES: Array<{
  id: Exclude<SettingsPage, 'main'>
  title: string
  description: string
  icon: ComponentType<SvgProps>
  // About wears the app's own mark, which is a bitmap rather than a tintable
  // glyph, so a row may carry one instead of drawing its icon.
  image?: ImageSourcePropType
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
    id: 'p2p-storage',
    title: 'P2P Data',
    description: 'App storage and downloaded cache',
    icon: DatabaseIcon
  },
  {
    id: 'permissions',
    title: 'Permissions',
    description: 'Site access and device defaults',
    icon: ShieldLockIcon
  },
  {
    id: 'link-device',
    title: 'Link Device',
    description: 'Sync with another device, or save a backup',
    icon: LinkIcon
  },
  {
    id: 'lan-discovery',
    // Not "LAN Discovery Test": what it is for is using PeerSky with no
    // internet, and a screen called Test reads as something unfinished.
    title: 'Offline',
    description: 'Use PeerSky with no internet, over local Wi-Fi',
    icon: DisplayIcon
  },
  {
    id: 'about',
    title: 'About',
    description: 'Version, source code, and licenses',
    icon: InfoIcon,
    image: require('../../assets/images/logo.png')
  }
]

export function SettingsScreen(props: SettingsScreenProps) {
  const [page, setPage] = useState<SettingsPage>(props.initialPage || 'main')
  const [transitionDirection, setTransitionDirection] = useState(1)
  const reduceMotion = useReducedMotion()
  const transition = useRef(new Animated.Value(1)).current
  const pageRef = useRef(page)
  pageRef.current = page
  const { registerGoBack } = props
  let content

  // Settings closes to show the link, so back has nothing of settings left to
  // return to. Naming the page it was opened from is what lets the browser put
  // it back instead of dropping the user wherever they were before.
  const openUrl = useCallback(
    (url: string) => props.onOpenUrl(url, pageRef.current),
    [props.onOpenUrl]
  )

  if (page === 'main') {
    content = (
      <SettingsHome
        onClose={props.onClose}
        onOpenPage={(nextPage) => changePage(nextPage, 1)}
      />
    )
  } else if (page === 'toolbar-button') {
    content = (
      <SettingsSubpage
        title='Toolbar Button'
        onBack={() => changePage('appearance', -1)}
      >
        <ToolbarButtonSettings selected={props.toolbarButton} onSelect={props.onToolbarButtonChange} />
      </SettingsSubpage>
    )
  } else if (page === 'address-bar-button') {
    content = (
      <SettingsSubpage
        title='Address Bar Button'
        onBack={() => changePage('appearance', -1)}
      >
        <AddressBarButtonSettings selected={props.addressBarButton} onSelect={props.onAddressBarButtonChange} />
      </SettingsSubpage>
    )
  } else if (page === 'site-data') {
    content = (
      <SettingsSubpage
        title='Cookies and site data'
        onBack={() => changePage('data-clearing', -1)}
      >
        <SiteData getSiteDataHosts={props.getSiteDataHosts} />
      </SettingsSubpage>
    )
  } else if (page === 'licenses') {
    // A long list of its own, so it scrolls itself rather than inside the
    // page's ScrollView.
    content = (
      <SettingsSubpage
        title='Open-source licenses'
        scrollable={false}
        onBack={() => changePage('about', -1)}
      >
        <Licenses onOpenUrl={openUrl} />
      </SettingsSubpage>
    )
  } else {
    content = (
      <SettingsSubpage
        title={getSettingsPageTitle(page)}
        onBack={() => changePage('main', -1)}
      >
        {page === 'general' && <General {...props} />}
        {page === 'accessibility' && <Accessibility {...props} />}
        {page === 'appearance' && (
          <Appearance
            {...props}
            onOpenAddressBarButton={() => changePage('address-bar-button', 1)}
            onOpenToolbarButton={() => changePage('toolbar-button', 1)}
          />
        )}
        {page === 'data-clearing' && (
          <DataClearing {...props} onOpenSiteData={() => changePage('site-data', 1)} />
        )}
        {page === 'privacy' && <Privacy {...props} onOpenUrl={openUrl} />}
        {page === 'p2p-storage' && (
          <P2PStorage
            downloadOnlyOnWifi={props.downloadOnlyOnWifi}
            offlineNetworkAllowed={props.offlineNetworkAllowed}
            onCallRpc={props.onCallRpc}
            onDownloadOnlyOnWifiChange={props.onDownloadOnlyOnWifiChange}
            onOfflineFoldersChanged={props.onOfflineFoldersChanged}
            onOpenItem={props.onOpenHyperItem}
            onOpenUrl={openUrl}
            onP2pmdDataDeleted={props.onP2pmdDataDeleted}
          />
        )}
        {page === 'permissions' && <Permissions {...props} />}
        {page === 'link-device' && (
          <LinkDeviceSettings
            onCallRpc={props.onCallRpc}
            onRestartRequired={props.onRestartRequired}
            onOpenUrl={openUrl}
          />
        )}
        {page === 'lan-discovery' && <LANDiscoveryTest onCallRpc={props.onCallRpc} />}
        {page === 'about' && (
          <AboutSettings onOpenUrl={openUrl} onOpenLicenses={() => changePage('licenses', 1)} />
        )}
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

  // P2P data and every other subpage sits inside this screen, so going back
  // from one used to close settings altogether and land on the page behind it.
  const goBackOnePage = useCallback(() => {
    if (pageRef.current === 'main') return false
    // Opened straight onto this page from outside, so back means leave, not
    // "up to a list the person never came through".
    if (props.closeOnBack && pageRef.current === props.initialPage) return false
    transition.stopAnimation()
    transition.setValue(reduceMotion ? 1 : 0)
    setTransitionDirection(-1)
    setPage(SETTINGS_PARENT_PAGES[pageRef.current] || 'main')
    return true
  }, [props.closeOnBack, props.initialPage, reduceMotion, transition])

  useEffect(() => {
    registerGoBack?.(goBackOnePage)
    return () => registerGoBack?.(null)
  }, [goBackOnePage, registerGoBack])

  function changePage(nextPage: SettingsPage, direction: number) {
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

function SettingsHome({
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
            const image = page.image ?? null

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
                  {image
                    ? <Image source={image} style={styles.menuIconImage} />
                    : (
                      <Icon
                        width={22}
                        height={22}
                        color={isDark ? '#8fc1ff' : '#1f6fd1'}
                      />
                      )}
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

function SettingsSubpage({
  title,
  onBack,
  scrollable = true,
  children
}: {
  title: string
  onBack: () => void
  scrollable?: boolean
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
      {scrollable
        ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {children}
          </ScrollView>
          )
        : <View style={styles.scroll}>{children}</View>}
    </View>
  )
}


function LANDiscoveryTest({
  onCallRpc
}: {
  onCallRpc: SettingsScreenProps['onCallRpc']
}) {
  const isDark = useSettingsDarkMode()
  const [lanStatus, setLANStatus] = useState<LANDiscoveryStatus | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const onCallRpcRef = useRef(onCallRpc)
  const refreshInFlightRef = useRef(false)

  useEffect(() => {
    onCallRpcRef.current = onCallRpc
  }, [onCallRpc])

  // The poll behind this runs every couple of seconds. Showing its spinner
  // put a flicker beside the connection count for as long as the page was
  // open, which reads as something going wrong rather than something working.
  // Only a refresh somebody asked for says so.
  const refreshStatus = useCallback(async ({ silent = false } = {}) => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    if (!silent) setIsRefreshing(true)

    try {
      const response = await withTimeout(
        onCallRpcRef.current(RPC_HYPER_LAN_STATUS, {}),
        5000
      )
      if (!response.ok || !response.lan) {
        throw new Error(response.error || 'Unable to read LAN discovery status')
      }

      setLANStatus(response.lan)
      setError(null)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      refreshInFlightRef.current = false
      if (!silent) setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = setInterval(() => void refreshStatus({ silent: true }), 2000)
    return () => clearInterval(timer)
  }, [refreshStatus])

  const peers = lanStatus?.peers || []

  return (
    <View style={[styles.pageContent, isDark ? darkStyles.page : null]}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      <SettingsSection title='Local LAN discovery'>
        <View style={styles.lanSummary}>
          <View style={styles.lanTitleRow}>
            <SettingCopy
              title={lanStatus?.available ? 'mDNS is active' : 'mDNS is unavailable'}
              description={lanStatus?.available
                ? `Listening at ${lanStatus.host || 'unknown'}:${lanStatus.port || 'unknown'} · ${lanStatus.joinedTopics} joined topics · ${lanStatus.activeConnections} active connections`
                : lanStatus?.error || 'Waiting for LAN discovery to start'}
            />
            {isRefreshing && <ActivityIndicator size='small' />}
          </View>
          {/* This page is where somebody comes when nearby devices are not
              showing up, so when discovery has genuinely failed it says why and
              offers the one place the answer can be changed. A refusal of the
              local network is the usual reason, and no app can ask for it a
              second time. */}
          {lanStatus && !lanStatus.available && (
            <View style={styles.lanHelp}>
              <Text style={[styles.lanHelpText, isDark ? darkStyles.secondaryText : null]}>
                {LAN_PERMISSION_HELP}
              </Text>
              <Pressable
                accessibilityRole='button'
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.rowPressed : null
                ]}
                onPress={() => offerPermissionSettings(LAN_PERMISSION_TITLE, LAN_PERMISSION_HELP)}
              >
                <Text style={[
                  styles.secondaryButtonText,
                  isDark ? darkStyles.primaryText : null
                ]}>
                  Open settings
                </Text>
              </Pressable>
            </View>
          )}
          {lanStatus?.publicKey && (
            <Text style={[styles.keyText, isDark ? darkStyles.primaryText : null]}>
              Local peer: {lanStatus.publicKey}
            </Text>
          )}
          <Pressable
            accessibilityRole='button'
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed ? styles.rowPressed : null
            ]}
            onPress={() => void refreshStatus()}
          >
            <Text style={[
              styles.secondaryButtonText,
              isDark ? darkStyles.primaryText : null
            ]}>
              Refresh peers
            </Text>
          </Pressable>
        </View>
      </SettingsSection>

      <SettingsSection title={`Discoverable peers (${peers.length})`}>
        {peers.length === 0 ? (
          <View style={styles.lanEmptyState}>
            <Text style={[styles.placeholderTitle, isDark ? darkStyles.primaryText : null]}>
              No peers discovered yet
            </Text>
            <Text style={[styles.helperText, isDark ? darkStyles.secondaryText : null]}>
              Open PeerSky on another device connected to the same Wi-Fi network. Neither one needs the internet: you can chat and share files with both of them offline.
            </Text>
          </View>
        ) : peers.map((peer, index) => (
          <View
            key={peer.publicKey}
            style={[
              styles.lanPeer,
              index > 0 ? styles.rowDivider : null,
              index > 0 && isDark ? darkStyles.divider : null
            ]}
          >
            <View style={styles.lanTitleRow}>
              <Text style={[styles.lanPeerTitle, isDark ? darkStyles.primaryText : null]}>
                {peer.host}:{peer.port || 'unknown'}
              </Text>
              <Text style={peer.connected || peer.reachable ? styles.lanReachable : styles.lanDiscovered}>
                {peer.connected ? 'Connected' : peer.reachable ? 'Reachable' : 'Discovered'}
              </Text>
            </View>
            <Text style={[styles.keyText, isDark ? darkStyles.primaryText : null]}>
              {peer.publicKey}
            </Text>
            <Text style={[styles.helperText, isDark ? darkStyles.secondaryText : null]}>
              Shared topics: {peer.sharedTopics} | Connections: {peer.activeConnections} | Last seen: {new Date(peer.lastSeen).toLocaleTimeString()}
            </Text>
          </View>
        ))}
      </SettingsSection>
    </View>
  )
}


async function withTimeout<T> (promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('LAN status request timed out')), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}


function AboutSettings({
  onOpenUrl,
  onOpenLicenses
}: {
  onOpenUrl: (url: string) => void
  onOpenLicenses: () => void
}) {
  const isDark = useSettingsDarkMode()
  // One address for everything: feedback, a bug, or content that needs taking
  // down. A GitHub account is not a fair thing to ask for any of those. The
  // version rides in the subject so a report says which build it came from.
  const feedbackMailUrl = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
    `Feedback for PeerSky ${Constants.expoConfig?.version || 'unknown'}`
  )}`

  return (
    <View style={[styles.pageContent, isDark ? darkStyles.page : null]}>
      <SettingsSection title='PeerSky Mobile'>
        <View style={styles.aboutRow}>
          <SettingCopy
            title='PeerSky'
            description={`Version ${Constants.expoConfig?.version || 'unknown'}`}
          />
        </View>
        <Pressable accessibilityRole='link' style={styles.linkRow} onPress={() => onOpenUrl(REPOSITORY_URL)}>
          <Text style={[styles.linkText, isDark ? darkStyles.primaryText : null]}>Source code</Text>
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
        <Pressable accessibilityRole='button' style={styles.linkRow} onPress={onOpenLicenses}>
          <Text style={[styles.linkText, isDark ? darkStyles.primaryText : null]}>Open-source licenses</Text>
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
        <Pressable accessibilityRole='link' style={styles.linkRow} onPress={() => onOpenUrl(feedbackMailUrl)}>
          <Text style={[styles.linkText, isDark ? darkStyles.primaryText : null]}>Send feedback</Text>
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

function getSettingsPageTitle(page: Exclude<SettingsPage, 'main'>) {
  return SETTINGS_PAGES.find((entry) => entry.id === page)?.title || 'Settings'
}

function useReducedMotion() {
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
  lanHelp: {
    gap: 10,
    marginTop: 4
  },
  lanHelpText: {
    color: '#657086',
    fontSize: 13,
    lineHeight: 19
  },
  menuIconImage: {
    height: 26,
    width: 26
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
  // The top border is the line between one row and the next, so the first row
  // in a card leaves it off: the card's own edge is already there and two of
  // them read as a thick rule.
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
  keyText: {
    color: '#1f2a44',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: '#d8e0ec',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14
  },
  secondaryButtonText: {
    color: '#1f2a44',
    fontSize: 14,
    fontWeight: '800'
  },
  // Reads the same in both themes: it sits on the secondary button, which
  // stays light, and this is a destructive action either way.
  helperText: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17
  },
  lanSummary: {
    gap: 12,
    padding: 16
  },
  lanTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between'
  },
  lanEmptyState: {
    gap: 7,
    padding: 20
  },
  lanPeer: {
    gap: 8,
    padding: 16
  },
  lanPeerTitle: {
    color: '#1f2a44',
    fontSize: 15,
    fontWeight: '800'
  },
  lanReachable: {
    color: '#24713a',
    fontSize: 12,
    fontWeight: '800'
  },
  lanDiscovered: {
    color: '#9a6200',
    fontSize: 12,
    fontWeight: '800'
  },
  placeholderTitle: {
    color: '#1f2a44',
    fontSize: 16,
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
  },
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
  },
})
