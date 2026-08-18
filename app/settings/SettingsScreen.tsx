import Constants from 'expo-constants'
import {
  type ComponentType,
  useEffect,
  useRef,
  useState
} from 'react'
import { CameraView, useCameraPermissions } from 'expo-camera'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Clipboard,
  Easing,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import type { SvgProps } from 'react-native-svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import {
  RPC_IDENTITY_GET_KEY,
  RPC_IDENTITY_RESTORE_FROM_HYPER,
  RPC_IDENTITY_CONFIRM_RESTORE
} from '../../backend/rpc/commands.mjs'
import { QrCodeView } from './QrCodeView'
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
import DisplayIcon from '../../assets/icons/bootstrap/display.svg'

type SettingsPage =
  | 'main'
  | 'general'
  | 'accessibility'
  | 'appearance'
  | 'data-clearing'
  | 'privacy'
  | 'permissions'
  | 'link-device'
  | 'about'

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
}

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
  storagePath: string
  onAddressBarPositionChange: (position: AddressBarPosition) => void
  onCallRpc: (command: number, data?: object) => Promise<RpcResponse>
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
  onIdentityRestored: () => void
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
    description: 'Site access and device defaults',
    icon: ShieldLockIcon
  },
  {
    id: 'link-device',
    title: 'Link Device',
    description: 'Restore identity from desktop',
    icon: DisplayIcon
  },
  {
    id: 'about',
    title: 'About',
    description: 'Version, source code, and licenses',
    icon: InfoIcon
  }
]

export function SettingsScreen(props: SettingsScreenProps) {
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
        {page === 'link-device' && <LinkDeviceSettings {...props} />}
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

function SettingsSubpage({
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


function LinkDeviceSettings({
  onCallRpc,
  storagePath,
  onIdentityRestored
}: SettingsScreenProps) {
  const isDark = useSettingsDarkMode()
  const [encryptionPublicKey, setEncryptionPublicKey] = useState('')
  const [nonce, setNonce] = useState('')
  const [hyperUrl, setHyperUrl] = useState('')
  const [isLoadingKey, setIsLoadingKey] = useState(true)
  const [isRestoring, setIsRestoring] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  useEffect(() => {
    let cancelled = false

    async function loadDeviceKey() {
      setIsLoadingKey(true)
      setError(null)

      try {
        const response = await onCallRpc(RPC_IDENTITY_GET_KEY, {})
        if (cancelled) return

        if (!response.ok || typeof response.encryptionPublicKey !== 'string') {
          throw new Error(response.error || 'Unable to load mobile device key')
        }

        setEncryptionPublicKey(response.encryptionPublicKey)
        setNonce(response.nonce || '')
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      } finally {
        if (!cancelled) setIsLoadingKey(false)
      }
    }

    void loadDeviceKey()

    return () => {
      cancelled = true
    }
  }, [onCallRpc])

  function copyDeviceKey() {
    if (!encryptionPublicKey) return

    try {
      Clipboard.setString(encryptionPublicKey)
      setMessage('Mobile device key copied.')
      setError(null)
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError))
    }
  }

  async function openScanner() {
    if (!permission?.granted) {
      const response = await requestPermission()
      if (!response.granted) {
        setError('Camera permission is required to scan QR codes.')
        return
      }
    }
    setIsScanning(true)
    setError(null)
  }

  function handleBarcodeScanned({ data }: { data: string }) {
    setIsScanning(false)
    if (data && data.startsWith('hyper://')) {
      setHyperUrl(data)
    } else {
      setError('Invalid QR code scanned. Must be a hyper:// URL.')
    }
  }

  async function restoreIdentity() {
    const trimmedUrl = hyperUrl.trim()
    if (!trimmedUrl.startsWith('hyper://')) {
      setError('Enter the hyper:// identity transfer URL from PeerSky Desktop.')
      setMessage(null)
      return
    }

    setIsRestoring(true)
    setError(null)
    setMessage(null)

    try {
      const response = await onCallRpc(RPC_IDENTITY_RESTORE_FROM_HYPER, {
        hyperUrl: trimmedUrl
      })

      if (!response.ok) {
        throw new Error(response.error || 'Identity restore failed')
      }

      Alert.alert(
        'Confirm Identity Restore',
        `Does this code match the desktop screen?\n\n${response.sas}\n\nRestoring will overwrite your identity and restart the app.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm & Restart',
            style: 'destructive',
            onPress: async () => {
              try {
                const confirmResponse = await onCallRpc(RPC_IDENTITY_CONFIRM_RESTORE, {})
                if (!confirmResponse.ok) throw new Error(confirmResponse.error)
                onIdentityRestored()
                BackHandler.exitApp()
              } catch (confirmError) {
                Alert.alert('Restore Failed', confirmError instanceof Error ? confirmError.message : String(confirmError))
              }
            }
          }
        ]
      )
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : String(restoreError))
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <View style={[styles.pageContent, isDark ? darkStyles.page : null]}>
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {message && (
        <View style={[styles.successBanner, isDark ? darkStyles.successBanner : null]}>
          <Text style={[styles.successText, isDark ? darkStyles.successText : null]}>{message}</Text>
        </View>
      )}

      <SettingsSection title='Mobile device key'>
        <View style={styles.linkDeviceBlock}>
          <SettingCopy
            title='Your Mobile Device Key'
            description='Scan this QR code with PeerSky Desktop or copy the key string below.'
          />
          {encryptionPublicKey && nonce ? <QrCodeView value={`peersky-identity:${encryptionPublicKey}?nonce=${nonce}`} size={200} /> : null}
          <View style={[styles.keyBox, isDark ? darkStyles.input : null]}>
            {isLoadingKey
              ? <ActivityIndicator size='small' />
              : (
                <Text
                  selectable
                  style={[styles.keyText, isDark ? darkStyles.primaryText : null]}
                >
                  {encryptionPublicKey || 'No key available'}
                </Text>
              )}
          </View>
          <Pressable
            accessibilityRole='button'
            disabled={!encryptionPublicKey}
            style={({ pressed }) => [
              styles.primaryButton,
              !encryptionPublicKey ? styles.buttonDisabled : null,
              pressed ? styles.rowPressed : null
            ]}
            onPress={copyDeviceKey}
          >
            <Text style={styles.primaryButtonText}>Copy Key</Text>
          </Pressable>
          <Text style={[styles.helperText, isDark ? darkStyles.secondaryText : null]}>
            Identity key file location: {storagePath || 'app document storage'}
          </Text>
        </View>
      </SettingsSection>

      <SettingsSection title='Restore from desktop'>
        <View style={styles.linkDeviceBlock}>
          <SettingCopy
            title='Identity transfer URL'
            description='Paste the hyper:// URL shown by PeerSky Desktop after uploading the encrypted identity transfer.'
          />
          <TextInput
            autoCapitalize='none'
            autoCorrect={false}
            editable={!isRestoring}
            multiline
            placeholder='hyper://...'
            placeholderTextColor={isDark ? '#6f7b91' : '#8a96a8'}
            style={[styles.urlInput, isDark ? darkStyles.input : null]}
            value={hyperUrl}
            onChangeText={setHyperUrl}
          />
          <Pressable
            accessibilityRole='button'
            disabled={isRestoring}
            style={({ pressed }) => [
              styles.primaryButton,
              isRestoring ? styles.buttonDisabled : null,
              pressed ? styles.rowPressed : null
            ]}
            onPress={restoreIdentity}
          >
            {isRestoring
              ? <ActivityIndicator color='#ffffff' size='small' />
              : <Text style={styles.primaryButtonText}>Restore Identity</Text>}
          </Pressable>
          <Pressable
            accessibilityRole='button'
            disabled={isRestoring}
            style={({ pressed }) => [
              styles.secondaryButton,
              isRestoring ? styles.buttonDisabled : null,
              pressed ? styles.rowPressed : null
            ]}
            onPress={openScanner}
          >
            <Text style={[styles.secondaryButtonText, isDark ? darkStyles.primaryText : null]}>Scan QR Code</Text>
          </Pressable>
        </View>
      </SettingsSection>

      <Modal visible={isScanning} animationType='slide' onRequestClose={() => setIsScanning(false)}>
        <View style={styles.scannerContainer}>
          {isScanning && (
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
          )}
          <View style={styles.scannerOverlay}>
            <View style={styles.scannerHeader}>
              <Pressable style={styles.scannerCloseButton} onPress={() => setIsScanning(false)}>
                <Text style={styles.scannerCloseText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}


function AboutSettings({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
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
  },
  linkDeviceBlock: {
    gap: 12,
    padding: 16
  },
  keyBox: {
    backgroundColor: '#f7f9fc',
    borderColor: '#d8e0ec',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 72,
    padding: 12
  },
  keyText: {
    color: '#1f2a44',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18
  },
  urlInput: {
    backgroundColor: '#f7f9fc',
    borderColor: '#d8e0ec',
    borderRadius: 12,
    borderWidth: 1,
    color: '#1f2a44',
    fontSize: 14,
    minHeight: 96,
    padding: 12,
    textAlignVertical: 'top'
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 14
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800'
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
  buttonDisabled: {
    opacity: 0.55
  },
  helperText: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17
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
  },
  successBanner: {
    backgroundColor: '#edf9f0',
    borderBottomColor: '#a9d9b5',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  successText: {
    color: '#246a36',
    fontSize: 13,
    lineHeight: 18
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000000'
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20
  },
  scannerHeader: {
    alignItems: 'flex-end',
    paddingTop: 40
  },
  scannerCloseButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  scannerCloseText: {
    color: '#ffffff',
    fontSize: 16,
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
  },
  input: {
    backgroundColor: '#121927',
    borderColor: BROWSER_PALETTES.dark.border,
    color: BROWSER_PALETTES.dark.text
  },
  successBanner: {
    backgroundColor: '#12301d',
    borderBottomColor: '#2d7b45'
  },
  successText: {
    color: '#bfeccb'
  }
})
