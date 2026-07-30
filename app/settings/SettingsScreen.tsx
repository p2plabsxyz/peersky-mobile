import Constants from 'expo-constants'
import { useEffect, useState } from 'react'
import { CameraView, useCameraPermissions } from 'expo-camera'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Clipboard,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native'
import { SEARCH_ENGINES } from './browser-preferences.mjs'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import {
  RPC_IDENTITY_GET_KEY,
  RPC_IDENTITY_INSPECT_STORAGE,
  RPC_IDENTITY_RESTORE_FROM_HYPER
} from '../../backend/rpc/commands.mjs'
import { QrCodeView } from './QrCodeView'
import { Appearance } from './Appearance'
import { Accessibility } from './Accessibility'
import { DataClearing } from './DataClearing'
import { Permissions } from './Permissions'
import {
  ChoiceGroup,
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
}

type SettingsScreenProps = {
  addressBarPosition: AddressBarPosition
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
  onClose: () => void
  onClearBrowsingData: () => boolean
  onEnforceManualPageZoomChange: (enabled: boolean) => void
  onExternalLinkBehaviorChange: (behavior: ExternalLinkBehavior) => void
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
    id: 'link-device',
    title: 'Link Device',
    description: 'Restore identity from desktop'
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
        {page === 'general' && <GeneralSettings {...props} />}
        {page === 'accessibility' && <Accessibility {...props} />}
        {page === 'appearance' && <Appearance {...props} />}
        {page === 'data-clearing' && <DataClearing {...props} />}
        {page === 'permissions' && <Permissions {...props} />}
        {page === 'link-device' && <LinkDeviceSettings {...props} />}
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

function GeneralSettings ({
  persistenceError,
  restoreTabsOnStartup,
  searchEngine,
  onRestoreTabsOnStartupChange,
  onSearchEngineChange,
  onResetTabs
}: SettingsScreenProps) {
  const isDark = useSettingsDarkMode()

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
    <View style={[styles.pageContent, isDark ? darkStyles.page : null]}>
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
          selected={searchEngine}
          onSelect={onSearchEngineChange}
        />
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

function LinkDeviceSettings ({
  onCallRpc,
  storagePath,
  onIdentityRestored
}: SettingsScreenProps) {
  const isDark = useSettingsDarkMode()
  const [encryptionPublicKey, setEncryptionPublicKey] = useState('')
  const [hyperUrl, setHyperUrl] = useState('')
  const [isLoadingKey, setIsLoadingKey] = useState(true)
  const [isRestoring, setIsRestoring] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  useEffect(() => {
    let cancelled = false

    async function loadDeviceKey () {
      setIsLoadingKey(true)
      setError(null)

      try {
        const response = await onCallRpc(RPC_IDENTITY_GET_KEY, {})
        if (cancelled) return

        if (!response.ok || typeof response.encryptionPublicKey !== 'string') {
          throw new Error(response.error || 'Unable to load mobile device key')
        }

        setEncryptionPublicKey(response.encryptionPublicKey)
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

  function copyDeviceKey () {
    if (!encryptionPublicKey) return

    try {
      Clipboard.setString(encryptionPublicKey)
      setMessage('Mobile device key copied.')
      setError(null)
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError))
    }
  }

  async function openScanner () {
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

  function handleBarcodeScanned ({ data }: { data: string }) {
    setIsScanning(false)
    if (data && data.startsWith('hyper://')) {
      setHyperUrl(data)
    } else {
      setError('Invalid QR code scanned. Must be a hyper:// URL.')
    }
  }

  async function restoreIdentity () {
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

      setMessage(`Identity restored. Restarting PeerSky Mobile...`)
      onIdentityRestored()
      Alert.alert(
        'Identity Restored',
        `Restored ${response.restoredFiles || 0} files. PeerSky Mobile will restart now to load the new identity.`,
        [
          {
            text: 'Restart Now',
            onPress: () => {
              BackHandler.exitApp()
            }
          }
        ],
        { cancelable: false }
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
          {encryptionPublicKey ? <QrCodeView value={encryptionPublicKey} size={200} /> : null}
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
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16
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
