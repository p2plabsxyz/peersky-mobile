import Constants from 'expo-constants'
import * as DocumentPicker from 'expo-document-picker'
import * as Sharing from 'expo-sharing'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { File, Paths } from 'expo-file-system'
import { type ComponentType, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Clipboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import type { SvgProps } from 'react-native-svg'
import {
  RPC_BACKUP_CREATE,
  RPC_BACKUP_ESTIMATE,
  RPC_BACKUP_INSPECT,
  RPC_BACKUP_RESTORE_FILE,
  RPC_HYPER_OFFLINE_RESUME_ALL,
  RPC_IDENTITY_CONFIRM_RESTORE,
  RPC_IDENTITY_DISCARD_RESTORE,
  RPC_IDENTITY_GET_KEY,
  RPC_IDENTITY_REMOVE,
  RPC_IDENTITY_RESTORE_FROM_HYPER,
  RPC_IDENTITY_SEND,
  RPC_IDENTITY_SEND_STOP
} from '../../backend/rpc/commands.mjs'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { tapFeedback } from '../haptics'
import { MODAL_ORIENTATIONS } from '../modal-orientations'
import { QrCodeView } from './QrCodeView'
import { SettingsSection, useSettingsDarkMode } from './SettingsUI'
import { classifyLinkDeviceCode, createMobilePairingCode } from './identity-pairing.mjs'
import {
  checkNewPassphrase,
  createBackupFileName,
  describeBackupContents,
  describeBackupOrigin,
  describePairingCodeLife,
  describeProgress,
  formatBackupSize,
  MIN_BACKUP_PASSPHRASE_LENGTH,
  toBareFsPath
} from './link-device-state.mjs'
import { type LinkDeviceProgress, subscribeLinkDeviceProgress } from './link-device-progress'
import { emitP2pmdNotesShared } from './p2pmd-shared-notes'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import DisplayIcon from '../../assets/icons/bootstrap/display.svg'
import DownloadIcon from '../../assets/icons/bootstrap/download.svg'
import LinkIcon from '../../assets/icons/bootstrap/link-45deg.svg'
import PhoneIcon from '../../assets/icons/bootstrap/phone.svg'
import QrScanIcon from '../../assets/icons/bootstrap/qr-code-scan.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import UploadIcon from '../../assets/icons/bootstrap/arrow-bar-up.svg'

type RpcResult = {
  ok: boolean
  error?: string
  code?: string
  [key: string]: any
}

type CallRpc = (command: number, data?: object) => Promise<RpcResult>

export type LinkDeviceProps = {
  onCallRpc: (command: number, data?: object) => Promise<any>
  // Swaps the app for a screen asking for a restart. Called before a restore
  // or a removal lands, not after, see replaceData below.
  onRestartRequired: () => void
  onOpenUrl: (url: string) => void
}

type PickedBackup = {
  uri: string
  path: string
  name: string
  needsPassphrase: boolean
  origin: string
  contents: string
  size: string
}

const PEERSKY_WEBSITE_URL = 'https://peersky.p2plabs.xyz'
const PEERSKY_VERSION = Constants.expoConfig?.version || ''
const ACCENT = '#1f6fd1'
const DANGER = '#c62f45'

// Link Device, laid out the way a sync screen in any browser is: this device,
// one way to sync with another, a backup for when this phone is gone, and the
// desktop app. Everything else stays out of the way.
export function LinkDeviceSettings ({ onCallRpc, onRestartRequired, onOpenUrl }: LinkDeviceProps) {
  const isDark = useSettingsDarkMode()
  const [syncVisible, setSyncVisible] = useState(false)
  const [backupVisible, setBackupVisible] = useState(false)
  const [restoreFile, setRestoreFile] = useState<PickedBackup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPicking, setIsPicking] = useState(false)

  // The parent builds a new onCallRpc on every render. Keying effects on it
  // re-ran them on every render, so it is read through a ref instead.
  const onCallRpcRef = useRef(onCallRpc)
  onCallRpcRef.current = onCallRpc
  const call = useCallback<CallRpc>((command, data = {}) => onCallRpcRef.current(command, data), [])

  // Everything that replaces or deletes data goes through here. The restart
  // screen replaces the app first, because the screens on show hold the old
  // data and PeerChat writes what it holds as it closes, over restored files.
  // It stays up until a relaunch: iOS cannot quit (exitApp is a no-op, and
  // exit() reads as a crash to Apple) and newer Android only backgrounds.
  const replaceData = useCallback(async (command: number, data: object, failureTitle: string) => {
    // The sheet goes first. On iOS a sheet still up when the screens under it
    // are swapped for the restart screen can stay stuck over it.
    setSyncVisible(false)
    setBackupVisible(false)
    await new Promise((resolve) => setTimeout(resolve, 450))
    onRestartRequired()
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      const response = await call(command, data)
      if (!response.ok) throw new Error(response.error || 'It did not go through')
      if (Platform.OS === 'android') BackHandler.exitApp()
    } catch (replaceError) {
      Alert.alert(
        failureTitle,
        `${errorMessage(replaceError)}\n\nNothing on this phone was changed. Close PeerSky and open it again.`
      )
    }
  }, [call, onRestartRequired])

  const commitRestore = useCallback((restoreId: string) => {
    void replaceData(RPC_IDENTITY_CONFIRM_RESTORE, { restoreId }, 'The restore did not go through')
  }, [replaceData])

  async function pickBackupFile () {
    if (isPicking) return
    setError(null)
    setIsPicking(true)
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false
      })
      if (result.canceled || !result.assets?.[0]) return

      const asset = result.assets[0]
      const path = toBareFsPath(asset.uri)
      const info = await call(RPC_BACKUP_INSPECT, { path })
      if (!info.ok) {
        deleteCachedFile(asset.uri)
        setError(info.error || 'That file is not a PeerSky backup.')
        return
      }

      setRestoreFile({
        uri: asset.uri,
        path,
        name: asset.name || 'Backup',
        needsPassphrase: info.needsPassphrase !== false,
        origin: describeBackupOrigin({ createdAt: info.createdAt, platform: info.platform }),
        contents: describeBackupContents(info.contents),
        size: formatBackupSize(info.sizeBytes)
      })
      setBackupVisible(true)
    } catch (pickError) {
      setError(errorMessage(pickError))
    } finally {
      setIsPicking(false)
    }
  }

  // The other half of moving to a new phone. Two phones with the same
  // profile write the same chats and split them, so the old one lets go.
  function removeData () {
    Alert.alert(
      'Remove your data from this phone?',
      'This deletes everything PeerSky keeps here: tabs, bookmarks, history, settings, chats, notes and files. Anything that is only on this phone is gone for good. Save a backup first if you need one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void replaceData(RPC_IDENTITY_REMOVE, {}, 'Your data was not removed')
          }
        }
      ]
    )
  }

  return (
    <View style={[styles.page, isDark ? darkStyles.page : null]}>
      <View style={styles.hero}>
        <View style={styles.heroIcons}>
          <View style={[styles.heroIcon, isDark ? darkStyles.heroIcon : null]}>
            <PhoneIcon width={26} height={26} color={isDark ? '#8fc1ff' : ACCENT} />
          </View>
          <LinkIcon width={22} height={22} color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'} />
          <View style={[styles.heroIcon, isDark ? darkStyles.heroIcon : null]}>
            <DisplayIcon width={26} height={26} color={isDark ? '#8fc1ff' : ACCENT} />
          </View>
        </View>
        <Text style={[styles.heroTitle, isDark ? darkStyles.text : null]}>Your data, on your devices</Text>
        <Text style={[styles.heroBody, isDark ? darkStyles.muted : null]}>
          Move your tabs, bookmarks, chats and files to another device, or keep a backup. It goes straight across, end-to-end encrypted, with no server in between.
        </Text>
      </View>

      {error && <Banner kind='error' text={error} onDismiss={() => setError(null)} />}

      <SettingsSection title='My devices'>
        <LinkRow
          icon={PhoneIcon}
          title={Platform.OS === 'ios' ? (Platform.isPad ? 'iPad' : 'iPhone') : 'Android phone'}
          trailing='This device'
        />
        <LinkRow
          accent
          divider
          icon={QrScanIcon}
          title='Sync with another device'
          onPress={() => setSyncVisible(true)}
        />
      </SettingsSection>

      <SettingsSection title='Backup'>
        <LinkRow
          chevron
          icon={DownloadIcon}
          title='Save a backup file'
          description='For when this phone is lost or broken. Keep it somewhere that is not this phone.'
          onPress={() => {
            setRestoreFile(null)
            setBackupVisible(true)
          }}
        />
        <LinkRow
          chevron
          divider
          busy={isPicking}
          icon={UploadIcon}
          title='Restore from a backup file'
          description='Bring a backup back, here or on a new phone.'
          onPress={() => void pickBackupFile()}
        />
      </SettingsSection>

      <SettingsSection title='Download'>
        <LinkRow
          chevron
          icon={DisplayIcon}
          title='Get the desktop browser'
          description='PeerSky for Mac, Windows and Linux.'
          onPress={() => onOpenUrl(PEERSKY_WEBSITE_URL)}
        />
      </SettingsSection>

      <SettingsSection title='This phone'>
        <LinkRow
          danger
          icon={TrashIcon}
          title='Remove my data from this phone'
          description='When you move to a new phone or give this one away.'
          onPress={removeData}
        />
      </SettingsSection>

      <Text style={[styles.footer, isDark ? darkStyles.muted : null]}>
        Nothing goes through a server. Your devices talk to each other directly, and only they can open what they send.
      </Text>

      <SyncSheet
        call={call}
        visible={syncVisible}
        onClose={() => setSyncVisible(false)}
        onConfirmRestore={commitRestore}
      />
      <BackupSheet
        call={call}
        restoreFile={restoreFile}
        visible={backupVisible}
        onClose={() => {
          setBackupVisible(false)
          if (restoreFile) deleteCachedFile(restoreFile.uri)
          setRestoreFile(null)
        }}
        onConfirmRestore={commitRestore}
      />
    </View>
  )
}

// One sheet for both directions, the way sync works in other browsers: show
// your code, or scan theirs. What the camera sees decides what happens: a
// pairing code means send this phone there, a transfer code means bring it
// here. Each tab only takes its own kind, so the wrong one is explained.
function SyncSheet ({
  call,
  visible,
  onClose,
  onConfirmRestore
}: {
  call: CallRpc
  visible: boolean
  onClose: () => void
  onConfirmRestore: (restoreId: string) => void
}) {
  const isDark = useSettingsDarkMode()
  const [direction, setDirection] = useState<'receive' | 'send'>('receive')
  const [pairingCode, setPairingCode] = useState('')
  const [pairingExpiresAt, setPairingExpiresAt] = useState(0)
  const [pairingRenewed, setPairingRenewed] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<LinkDeviceProgress | null>(null)
  const [sending, setSending] = useState<{ url: string, code: string, toDesktop: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [scanning, setScanning] = useState(false)
  const scanHandledRef = useRef(false)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const [permission, requestPermission] = useCameraPermissions()

  useEffect(() => subscribeLinkDeviceProgress(setProgress), [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setDirection('receive')
    setSending(null)
    setError(null)
    setCopied(false)
    setPairingCode('')
    setPairingExpiresAt(0)
    setPairingRenewed(false)

    void (async () => {
      try {
        const response = await call(RPC_IDENTITY_GET_KEY)
        if (cancelled) return
        if (!response.ok) throw new Error(response.error || 'Unable to load this phone\'s code')
        setPairingCode(createMobilePairingCode(response.encryptionPublicKey, response.nonce))
        setPairingExpiresAt(Number(response.expiresAt) || 0)
        setClock(Date.now())
      } catch (loadError) {
        if (!cancelled) setError(errorMessage(loadError))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [call, visible])

  // The code works for 15 minutes from when this phone first showed it, so the
  // sheet says how long is left. When it runs out the phone makes a new one
  // and says so: a desktop still holding the old code would build a transfer
  // this phone then refuses.
  useEffect(() => {
    if (!visible || direction !== 'receive' || sending || busy || !pairingExpiresAt) return
    let cancelled = false
    let renewing = false
    const tick = () => {
      const now = Date.now()
      setClock(now)
      if (now < pairingExpiresAt || renewing) return
      renewing = true
      call(RPC_IDENTITY_GET_KEY)
        .then((response) => {
          if (cancelled) return
          if (!response.ok) {
            renewing = false
            return
          }
          setPairingCode(createMobilePairingCode(response.encryptionPublicKey, response.nonce))
          setPairingExpiresAt(Number(response.expiresAt) || 0)
          setPairingRenewed(true)
          setCopied(false)
        })
        .catch(() => { renewing = false })
    }
    tick()
    const timer = setInterval(tick, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [busy, call, direction, pairingExpiresAt, sending, visible])

  function close () {
    if (sending) void call(RPC_IDENTITY_SEND_STOP).catch(() => {})
    setSending(null)
    setBusy(null)
    onClose()
  }

  async function openScanner () {
    setError(null)
    if (!permission?.granted) {
      const response = await requestPermission()
      if (!response.granted) {
        setError('PeerSky needs the camera to scan the other device\'s code. You can paste the code instead.')
        return
      }
    }
    scanHandledRef.current = false
    setScanning(true)
  }

  async function pasteCode () {
    setError(null)
    try {
      await handleCode(await Clipboard.getString())
    } catch (pasteError) {
      setError(errorMessage(pasteError))
    }
  }

  async function handleCode (text: string) {
    const result = classifyLinkDeviceCode(text) as {
      kind: string
      error?: string
      url?: string
      code?: string
      deviceType?: string
    }
    if (result.kind === 'empty') {
      setError('There is no code on the clipboard.')
      return
    }
    if (result.kind === 'invalid') {
      setError(result.error || 'That is not a PeerSky code.')
      return
    }
    // Each tab takes one kind of code. A pairing code on Receive here is the
    // other device's code for receiving, and acting on it would start sending
    // from this phone instead; a transfer on Send from here is the other way
    // round. Say which code belongs where rather than switching direction.
    if (result.kind === 'pairing' && direction === 'receive') {
      setError('That is the other device\'s code for receiving, so it does not go here. Once the other device starts sending to this phone, scan the code it shows then. To send from this phone instead, switch to Send from here.')
      return
    }
    if (result.kind === 'transfer' && direction === 'send') {
      setError('That code is a transfer for this phone to receive. Switch to Receive here and scan it there.')
      return
    }
    if (result.kind === 'transfer' && result.url) {
      await receive(result.url)
      return
    }
    if (result.code) confirmSend(result.code, result.deviceType === 'desktop')
  }

  async function receive (url: string) {
    setError(null)
    setProgress(null)
    setBusy('Getting your data')
    try {
      const response = await call(RPC_IDENTITY_RESTORE_FROM_HYPER, { hyperUrl: url })
      if (!response.ok) throw new Error(response.error || 'The transfer did not come through.')
      if (!visibleRef.current) {
        void call(RPC_IDENTITY_DISCARD_RESTORE, { restoreId: response.restoreId }).catch(() => {})
        return
      }
      setBusy(null)
      confirmRestore(response)
    } catch (receiveError) {
      setBusy(null)
      setError(errorMessage(receiveError))
    }
  }

  function confirmRestore (response: RpcResult) {
    const what = describeBackupContents(response.contents)
    const fromDesktop = response.source === 'desktop'
    Alert.alert(
      'Does the other device show this code?',
      `${response.sas}\n\n${fromDesktop
        ? `${what || 'Your data'} from the desktop will be added to this phone.`
        : `${what || 'Everything'} from the other phone will replace what is on this one.`} PeerSky restarts to finish.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => void call(RPC_IDENTITY_DISCARD_RESTORE, { restoreId: response.restoreId }).catch(() => {})
        },
        {
          text: 'It matches',
          style: fromDesktop ? 'default' : 'destructive',
          onPress: () => onConfirmRestore(response.restoreId)
        }
      ]
    )
  }

  function confirmSend (code: string, toDesktop: boolean) {
    Alert.alert(
      toDesktop ? 'Send to PeerSky Desktop?' : 'Send this phone to the other one?',
      toDesktop
        ? 'It gets the pages open on this phone and your bookmarks, added to its own, and can open your private files.' +
          // A desktop says in its code whether it takes PeerChat and P2PMD notes.
          (/[?&]chat=1(&|$)/.test(code) ? ' PeerChat there takes your name and rooms.' : '') +
          (/[?&]notes=1(&|$)/.test(code) ? ' P2PMD there gets your recent notes.' : '') +
          ' Nothing passes through a server.'
        : 'It gets everything on this phone: tabs, bookmarks, history, settings, chats, notes and files. Nothing passes through a server.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => void send(code, toDesktop) }
      ]
    )
  }

  async function send (code: string, toDesktop: boolean) {
    setError(null)
    setProgress(null)
    setLinkCopied(false)
    setBusy(toDesktop ? 'Getting your tabs and bookmarks ready' : 'Packing up your data')
    try {
      const response = await call(RPC_IDENTITY_SEND, {
        pairingCode: code,
        peerskyVersion: PEERSKY_VERSION,
        platform: Platform.OS
      })
      if (!response.ok) throw new Error(response.error || 'Could not send')
      if (!visibleRef.current) {
        void call(RPC_IDENTITY_SEND_STOP).catch(() => {})
        return
      }
      tapFeedback()
      setSending({ url: response.url, code: response.verificationCode, toDesktop })
      if (toDesktop) emitP2pmdNotesShared(response.sharedNotes)
    } catch (sendError) {
      setError(errorMessage(sendError))
    } finally {
      setBusy(null)
      // Offline downloads stop while the stores are packed. Only the app knows
      // whether it is on Wi-Fi, so it is the one that starts them again.
      void call(RPC_HYPER_OFFLINE_RESUME_ALL).catch(() => {})
    }
  }

  function copyCode () {
    if (!pairingCode) return
    Clipboard.setString(pairingCode)
    tapFeedback()
    setCopied(true)
  }

  // A desktop scans with its webcam, which is fiddly; pasting the link is the
  // usual way there, and on Apple devices the copy reaches the Mac by itself.
  function copyLink () {
    if (!sending) return
    Clipboard.setString(sending.url)
    tapFeedback()
    setLinkCopied(true)
  }

  return (
    <SheetFrame title='Sync with another device' visible={visible} onClose={close} closeLabel={sending ? 'Done' : 'Close'}>
      {error && <Banner kind='error' text={error} onDismiss={() => setError(null)} />}

      {busy
        ? <Working title={busy} progress={progress} />
        : sending
          ? (
            <View style={styles.sheetBlock}>
              <Text style={[styles.sheetHeading, isDark ? darkStyles.text : null]}>
                {sending.toDesktop ? 'Open this on the desktop' : 'Scan this on the other phone'}
              </Text>
              <Text style={[styles.sheetText, isDark ? darkStyles.muted : null]}>
                {sending.toDesktop
                  ? 'In PeerSky Desktop, open Backup & Restore. Under Restore from the network, paste this link or scan it, then press Download.'
                  : 'In Sync with another device on the other phone, tap Scan code and point it here.'}
              </Text>
              <QrCodeView value={sending.url} size={220} />
              <Pressable accessibilityRole='button' hitSlop={8} onPress={copyLink}>
                <Text style={styles.linkText}>{linkCopied ? 'Link copied' : 'Copy link'}</Text>
              </Pressable>
              <View style={[styles.codeBox, isDark ? darkStyles.codeBox : null]}>
                <Text style={[styles.codeLabel, isDark ? darkStyles.muted : null]}>
                  {sending.toDesktop ? 'Both screens show' : 'Both phones show'}
                </Text>
                <Text style={[styles.codeValue, isDark ? darkStyles.text : null]}>{sending.code}</Text>
              </View>
              <Text style={[styles.sheetText, isDark ? darkStyles.muted : null]}>
                {sending.toDesktop
                  ? 'Keep PeerSky open on this phone until the desktop has it. This code works for 15 minutes.'
                  : 'Keep PeerSky open on both phones until it finishes. This code works for 15 minutes.'}
              </Text>
              {!sending.toDesktop && (
                <Text style={[styles.sheetNote, isDark ? darkStyles.muted : null]}>
                  Moving for good? Once the new phone has everything, remove your data from this one, so the two are not using the same chats.
                </Text>
              )}
            </View>
            )
          : (
            <View style={styles.sheetBlock}>
              <Segmented
                options={[
                  { id: 'receive', title: 'Receive here' },
                  { id: 'send', title: 'Send from here' }
                ]}
                selected={direction}
                onSelect={(value) => {
                  setDirection(value as 'receive' | 'send')
                  setError(null)
                }}
              />

              {direction === 'receive'
                ? (
                  <>
                    <Step number={1} text='On the phone that has your data, open Link Device and tap Sync with another device. On PeerSky Desktop, open Backup & Restore and use Identity transfer.' />
                    <Step number={2} text='Scan this code with it, or paste it there.' />
                    {pairingCode
                      ? <QrCodeView value={pairingCode} size={200} />
                      : <ActivityIndicator style={styles.qrLoading} />}
                    <Pressable accessibilityRole='button' disabled={!pairingCode} hitSlop={8} onPress={copyCode}>
                      <Text style={styles.linkText}>{copied ? 'Code copied' : 'Copy code instead'}</Text>
                    </Pressable>
                    {pairingCode !== '' && pairingExpiresAt > 0 && (
                      <Text style={[styles.sheetNote, isDark ? darkStyles.muted : null]}>
                        {describePairingCodeLife(pairingExpiresAt - clock)}
                      </Text>
                    )}
                    {pairingRenewed && (
                      <Text style={[styles.sheetNote, isDark ? darkStyles.muted : null]}>
                        The last code ran out, so this is a new one. If the other device has the old code, scan this one there instead.
                      </Text>
                    )}
                    <Step number={3} text='It then shows a code of its own. Scan that one here.' />
                  </>
                  )
                : (
                  <>
                    <Step number={1} text='On the other phone, open Link Device and tap Sync with another device. On PeerSky Desktop, open Backup & Restore.' />
                    <Step number={2} text='Scan the code it shows. A phone gets everything on this one. The desktop gets your open pages, bookmarks, PeerChat rooms and recent notes.' />
                  </>
                  )}

              <View style={styles.buttonRow}>
                <Pressable
                  accessibilityRole='button'
                  style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null]}
                  onPress={() => void openScanner()}
                >
                  <QrScanIcon width={18} height={18} color='#ffffff' />
                  <Text style={styles.primaryButtonText}>Scan code</Text>
                </Pressable>
                <Pressable
                  accessibilityRole='button'
                  style={({ pressed }) => [styles.secondaryButton, isDark ? darkStyles.secondaryButton : null, pressed ? styles.pressed : null]}
                  onPress={() => void pasteCode()}
                >
                  <Text style={[styles.secondaryButtonText, isDark ? darkStyles.text : null]}>Paste code</Text>
                </Pressable>
              </View>
            </View>
            )}

      <Modal
        animationType='slide'
        supportedOrientations={MODAL_ORIENTATIONS}
        visible={scanning}
        onRequestClose={() => setScanning(false)}
      >
        {/* Its own root view on iOS: without a provider the overlay got no insets. */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <View style={styles.scanner}>
          {scanning && (
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              style={StyleSheet.absoluteFillObject}
              onBarcodeScanned={({ data }) => {
                if (scanHandledRef.current) return
                scanHandledRef.current = true
                setScanning(false)
                void handleCode(data)
              }}
            />
          )}
          <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.scannerOverlay}>
            <Text style={styles.scannerHint}>Point the camera at the code on the other device</Text>
            <Pressable accessibilityRole='button' style={styles.scannerClose} onPress={() => setScanning(false)}>
              <Text style={styles.scannerCloseText}>Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </View>
        </SafeAreaProvider>
      </Modal>
    </SheetFrame>
  )
}

// Saving a backup, or putting one back. A backup is encrypted with a
// passphrase, because it carries the keys to everything, and it goes wherever
// the person sends it: Files, iCloud Drive, Google Drive, email, another phone.
function BackupSheet ({
  call,
  restoreFile,
  visible,
  onClose,
  onConfirmRestore
}: {
  call: CallRpc
  restoreFile: PickedBackup | null
  visible: boolean
  onClose: () => void
  onConfirmRestore: (restoreId: string) => void
}) {
  const isDark = useSettingsDarkMode()
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [estimate, setEstimate] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<LinkDeviceProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFile, setSavedFile] = useState<{ uri: string, size: string } | null>(null)
  const savedFileRef = useRef<string | null>(null)
  // Work outlives the sheet: it can be closed while a backup is still being
  // packed. Whatever comes back after that is cleaned up, not acted on.
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const isRestore = restoreFile !== null

  useEffect(() => subscribeLinkDeviceProgress(setProgress), [])

  useEffect(() => {
    if (!visible) return
    setPassphrase('')
    setConfirmation('')
    setShowPassphrase(false)
    setError(null)
    setSavedFile(null)
    setEstimate(null)
    if (isRestore) return

    let cancelled = false
    void call(RPC_BACKUP_ESTIMATE).then((response) => {
      if (!cancelled && response.ok) setEstimate(Number(response.bytes) || 0)
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [call, isRestore, visible])

  function close () {
    // The file only needs to live until it has been handed to the share
    // sheet. It is encrypted, but there is no reason to leave a copy behind.
    if (savedFileRef.current) deleteCachedFile(savedFileRef.current)
    savedFileRef.current = null
    setBusy(null)
    onClose()
  }

  async function createBackup () {
    const problem = checkNewPassphrase(passphrase, confirmation)
    if (problem) {
      setError(problem)
      return
    }

    setError(null)
    setProgress(null)
    setBusy('Packing up your data')
    const file = new File(Paths.cache, createBackupFileName())
    try {
      if (file.exists) file.delete()
      const response = await call(RPC_BACKUP_CREATE, {
        outPath: toBareFsPath(file.uri),
        passphrase,
        peerskyVersion: PEERSKY_VERSION,
        platform: Platform.OS
      })
      if (!response.ok) throw new Error(response.error || 'Could not make the backup')
      if (!visibleRef.current) {
        deleteCachedFile(file.uri)
        return
      }
      savedFileRef.current = file.uri
      setSavedFile({ uri: file.uri, size: formatBackupSize(response.bytes) })
      setPassphrase('')
      setConfirmation('')
      tapFeedback()
      await shareBackup(file.uri)
    } catch (createError) {
      setError(errorMessage(createError))
    } finally {
      setBusy(null)
      void call(RPC_HYPER_OFFLINE_RESUME_ALL).catch(() => {})
    }
  }

  async function shareBackup (uri: string) {
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is not available on this phone')
      await Sharing.shareAsync(uri, {
        dialogTitle: 'Save your PeerSky backup',
        mimeType: 'application/octet-stream',
        UTI: 'public.data'
      })
    } catch (shareError) {
      setError(errorMessage(shareError))
    }
  }

  async function restoreBackup () {
    if (!restoreFile) return
    if (restoreFile.needsPassphrase && !passphrase) {
      setError('Enter the passphrase for this backup.')
      return
    }

    setError(null)
    setProgress(null)
    setBusy('Unpacking your backup')
    try {
      const response = await call(RPC_BACKUP_RESTORE_FILE, { path: restoreFile.path, passphrase })
      if (!response.ok) throw new Error(response.error || 'Could not open the backup')
      if (!visibleRef.current) {
        void call(RPC_IDENTITY_DISCARD_RESTORE, { restoreId: response.restoreId }).catch(() => {})
        return
      }
      setBusy(null)
      Alert.alert(
        'Replace what is on this phone?',
        `${describeBackupContents(response.contents) || 'Everything'} from the backup will replace what is on this phone. PeerSky restarts to finish.`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => void call(RPC_IDENTITY_DISCARD_RESTORE, { restoreId: response.restoreId }).catch(() => {})
          },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => onConfirmRestore(response.restoreId)
          }
        ]
      )
    } catch (restoreError) {
      setBusy(null)
      setError(errorMessage(restoreError))
    }
  }

  const passphraseProblem = isRestore ? null : checkNewPassphrase(passphrase, confirmation)

  return (
    <SheetFrame
      title={isRestore ? 'Restore from a backup' : 'Save a backup file'}
      visible={visible}
      onClose={close}
      closeLabel={savedFile ? 'Done' : 'Close'}
    >
      {error && <Banner kind='error' text={error} onDismiss={() => setError(null)} />}

      {busy
        ? <Working title={busy} progress={progress} />
        : savedFile
          ? (
            <View style={styles.sheetBlock}>
              <Banner kind='success' text={`Your backup is ready (${savedFile.size}).`} />
              <Text style={[styles.sheetText, isDark ? darkStyles.muted : null]}>
                Keep the file somewhere that is not this phone, like iCloud Drive, Google Drive or your computer, and keep the passphrase with it. PeerSky cannot open the file without it.
              </Text>
              <Pressable
                accessibilityRole='button'
                style={({ pressed }) => [styles.primaryButton, pressed ? styles.pressed : null]}
                onPress={() => void shareBackup(savedFile.uri)}
              >
                <Text style={styles.primaryButtonText}>Save or send it again</Text>
              </Pressable>
            </View>
            )
          : (
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBlock}>
              {isRestore
                ? (
                  <View style={[styles.fileCard, isDark ? darkStyles.codeBox : null]}>
                    <Text numberOfLines={1} style={[styles.fileName, isDark ? darkStyles.text : null]}>{restoreFile.name}</Text>
                    <Text style={[styles.sheetText, isDark ? darkStyles.muted : null]}>
                      {restoreFile.origin} · {restoreFile.size}
                    </Text>
                    {restoreFile.contents
                      ? <Text style={[styles.sheetText, isDark ? darkStyles.muted : null]}>{restoreFile.contents}</Text>
                      : null}
                  </View>
                  )
                : (
                  <Text style={[styles.sheetText, isDark ? darkStyles.muted : null]}>
                    One file with your tabs, bookmarks, history, settings, chats, notes and files{estimate !== null ? `, about ${formatBackupSize(estimate)}` : ''}. It is locked with a passphrase you choose, and you will need it to restore.
                  </Text>
                  )}

              {(!isRestore || restoreFile.needsPassphrase) && (
                <>
                  <TextInput
                    accessibilityLabel='Passphrase'
                    autoCapitalize='none'
                    autoComplete='off'
                    autoCorrect={false}
                    placeholder={isRestore ? 'Passphrase' : `Passphrase, at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters`}
                    placeholderTextColor={isDark ? '#6f7b91' : '#8a96a8'}
                    secureTextEntry={!showPassphrase}
                    style={[styles.input, isDark ? darkStyles.input : null]}
                    textContentType={isRestore ? 'password' : 'newPassword'}
                    value={passphrase}
                    onChangeText={(value) => {
                      setPassphrase(value)
                      if (error) setError(null)
                    }}
                  />
                  {!isRestore && (
                    <TextInput
                      accessibilityLabel='Confirm passphrase'
                      autoCapitalize='none'
                      autoComplete='off'
                      autoCorrect={false}
                      placeholder='Type it again'
                      placeholderTextColor={isDark ? '#6f7b91' : '#8a96a8'}
                      secureTextEntry={!showPassphrase}
                      style={[styles.input, isDark ? darkStyles.input : null]}
                      textContentType='newPassword'
                      value={confirmation}
                      onChangeText={(value) => {
                        setConfirmation(value)
                        if (error) setError(null)
                      }}
                    />
                  )}
                  <Pressable accessibilityRole='button' hitSlop={8} onPress={() => setShowPassphrase((value) => !value)}>
                    <Text style={styles.linkText}>{showPassphrase ? 'Hide passphrase' : 'Show passphrase'}</Text>
                  </Pressable>
                  {!isRestore && (
                    <Text style={[styles.sheetNote, isDark ? darkStyles.muted : null]}>
                      PeerSky cannot recover a forgotten passphrase. Write it down.
                    </Text>
                  )}
                </>
              )}

              <Pressable
                accessibilityRole='button'
                disabled={Boolean(passphraseProblem)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isRestore ? styles.dangerButton : null,
                  passphraseProblem ? styles.disabled : null,
                  pressed ? styles.pressed : null
                ]}
                onPress={() => void (isRestore ? restoreBackup() : createBackup())}
              >
                <Text style={styles.primaryButtonText}>{isRestore ? 'Restore' : 'Create backup'}</Text>
              </Pressable>
            </KeyboardAvoidingView>
            )}
    </SheetFrame>
  )
}

function SheetFrame ({
  title,
  visible,
  closeLabel,
  onClose,
  children
}: {
  title: string
  visible: boolean
  closeLabel: string
  onClose: () => void
  children: ReactNode
}) {
  const isDark = useSettingsDarkMode()

  return (
    <Modal
      animationType='slide'
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={Platform.OS === 'ios' ? ['left', 'right', 'bottom'] : ['top', 'left', 'right', 'bottom']}
        style={[styles.sheet, isDark ? darkStyles.page : null]}
      >
        <View style={[styles.sheetHeader, isDark ? darkStyles.sheetHeader : null]}>
          <Text style={[styles.sheetTitle, isDark ? darkStyles.text : null]}>{title}</Text>
          <Pressable accessibilityRole='button' hitSlop={10} onPress={onClose}>
            <Text style={styles.sheetClose}>{closeLabel}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps='handled'>
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function LinkRow ({
  icon: Icon,
  title,
  description,
  trailing,
  accent = false,
  danger = false,
  chevron = false,
  divider = false,
  busy = false,
  onPress
}: {
  icon: ComponentType<SvgProps>
  title: string
  description?: string
  trailing?: string
  accent?: boolean
  danger?: boolean
  chevron?: boolean
  divider?: boolean
  busy?: boolean
  onPress?: () => void
}) {
  const isDark = useSettingsDarkMode()
  const titleColor = danger ? DANGER : accent ? (isDark ? '#8fc1ff' : ACCENT) : isDark ? BROWSER_PALETTES.dark.text : '#1f2a44'
  const iconColor = danger ? DANGER : isDark ? '#8fc1ff' : ACCENT

  const content = (
    <>
      <Icon width={20} height={20} color={iconColor} />
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, { color: titleColor }]}>{title}</Text>
        {description
          ? <Text style={[styles.rowDescription, isDark ? darkStyles.muted : null]}>{description}</Text>
          : null}
      </View>
      {trailing ? <Text style={[styles.rowTrailing, isDark ? darkStyles.muted : null]}>{trailing}</Text> : null}
      {busy ? <ActivityIndicator size='small' /> : null}
      {chevron && !busy
        ? <ChevronRightIcon width={16} height={16} color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'} />
        : null}
    </>
  )

  const rowStyle = [styles.row, divider ? styles.rowDivider : null, divider && isDark ? darkStyles.rowDivider : null]
  if (!onPress) return <View style={rowStyle}>{content}</View>

  return (
    <Pressable
      accessibilityLabel={description ? `${title}. ${description}` : title}
      accessibilityRole='button'
      disabled={busy}
      style={({ pressed }) => [...rowStyle, pressed ? styles.pressed : null]}
      onPress={onPress}
    >
      {content}
    </Pressable>
  )
}

function Segmented ({
  options,
  selected,
  onSelect
}: {
  options: Array<{ id: string, title: string }>
  selected: string
  onSelect: (id: string) => void
}) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.segmented, isDark ? darkStyles.segmented : null]}>
      {options.map((option) => {
        const isSelected = option.id === selected
        return (
          <Pressable
            key={option.id}
            accessibilityRole='tab'
            accessibilityState={{ selected: isSelected }}
            style={[styles.segment, isSelected ? styles.segmentSelected : null, isSelected && isDark ? darkStyles.segmentSelected : null]}
            onPress={() => onSelect(option.id)}
          >
            <Text style={[
              styles.segmentText,
              isDark ? darkStyles.muted : null,
              isSelected ? styles.segmentTextSelected : null,
              isSelected && isDark ? darkStyles.text : null
            ]}>
              {option.title}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Step ({ number, text }: { number: number, text: string }) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <Text style={[styles.stepText, isDark ? darkStyles.text : null]}>{text}</Text>
    </View>
  )
}

function Working ({ title, progress }: { title: string, progress: LinkDeviceProgress | null }) {
  const isDark = useSettingsDarkMode()
  const described = progress ? describeProgress(progress) : null

  return (
    <View style={styles.working}>
      <ActivityIndicator size='large' />
      <Text style={[styles.sheetHeading, isDark ? darkStyles.text : null]}>{described?.label || title}</Text>
      {described?.fraction != null && (
        <View style={[styles.progressTrack, isDark ? darkStyles.progressTrack : null]}>
          <View style={[styles.progressFill, { width: `${Math.round(described.fraction * 100)}%` }]} />
        </View>
      )}
      {described?.detail ? <Text style={[styles.sheetText, isDark ? darkStyles.muted : null]}>{described.detail}</Text> : null}
      <Text style={[styles.sheetNote, isDark ? darkStyles.muted : null]}>Keep PeerSky open until this finishes.</Text>
    </View>
  )
}

function Banner ({ kind, text, onDismiss }: { kind: 'error' | 'success', text: string, onDismiss?: () => void }) {
  return (
    <Pressable
      accessibilityRole={onDismiss ? 'button' : undefined}
      disabled={!onDismiss}
      style={[styles.banner, kind === 'error' ? styles.bannerError : styles.bannerSuccess]}
      onPress={onDismiss}
    >
      <Text style={kind === 'error' ? styles.bannerErrorText : styles.bannerSuccessText}>{text}</Text>
    </Pressable>
  )
}

function deleteCachedFile (uri: string) {
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {}
}

function errorMessage (error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    paddingBottom: 32
  },
  hero: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 28,
    paddingTop: 24
  },
  heroIcons: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginBottom: 6
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: '#e3eefc',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56
  },
  heroTitle: {
    color: '#1f2a44',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center'
  },
  heroBody: {
    color: '#687086',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'
  },
  footer: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 20,
    paddingTop: 16,
    textAlign: 'center'
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  rowDivider: {
    borderTopColor: '#e1e7f0',
    borderTopWidth: 1
  },
  rowCopy: {
    flex: 1,
    gap: 3
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700'
  },
  rowDescription: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17
  },
  rowTrailing: {
    color: '#8190a7',
    fontSize: 14
  },
  pressed: {
    opacity: 0.7
  },
  disabled: {
    opacity: 0.45
  },
  banner: {
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  bannerError: {
    backgroundColor: '#fde8ec'
  },
  bannerSuccess: {
    backgroundColor: '#e3f5ea'
  },
  bannerErrorText: {
    color: '#8f2740',
    fontSize: 13,
    lineHeight: 18
  },
  bannerSuccessText: {
    color: '#1d6b3f',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  sheet: {
    backgroundColor: '#f5f8fc',
    flex: 1
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomColor: '#e1e7f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16
  },
  sheetTitle: {
    color: '#1f2a44',
    flex: 1,
    fontSize: 17,
    fontWeight: '800'
  },
  sheetClose: {
    color: ACCENT,
    fontSize: 16,
    fontWeight: '700'
  },
  sheetContent: {
    paddingBottom: 40
  },
  sheetBlock: {
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 18
  },
  sheetHeading: {
    color: '#1f2a44',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center'
  },
  sheetText: {
    color: '#687086',
    fontSize: 14,
    lineHeight: 20
  },
  sheetNote: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17
  },
  segmented: {
    backgroundColor: '#e7edf5',
    borderRadius: 10,
    flexDirection: 'row',
    padding: 3
  },
  segment: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    paddingVertical: 9
  },
  segmentSelected: {
    backgroundColor: '#ffffff'
  },
  segmentText: {
    color: '#687086',
    fontSize: 14,
    fontWeight: '700'
  },
  segmentTextSelected: {
    color: '#1f2a44'
  },
  step: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12
  },
  stepNumber: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    marginTop: 1,
    width: 22
  },
  stepNumberText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800'
  },
  stepText: {
    color: '#1f2a44',
    flex: 1,
    fontSize: 14,
    lineHeight: 20
  },
  qrLoading: {
    marginVertical: 60
  },
  linkText: {
    color: ACCENT,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center'
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: ACCENT,
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 16
  },
  dangerButton: {
    backgroundColor: DANGER
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800'
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d5deeb',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 16
  },
  secondaryButtonText: {
    color: '#1f2a44',
    fontSize: 15,
    fontWeight: '700'
  },
  codeBox: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    gap: 4,
    paddingVertical: 12
  },
  codeLabel: {
    color: '#687086',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  codeValue: {
    color: '#1f2a44',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 6
  },
  fileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    gap: 4,
    padding: 14
  },
  fileName: {
    color: '#1f2a44',
    fontSize: 15,
    fontWeight: '800'
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#d5deeb',
    borderRadius: 12,
    borderWidth: 1,
    color: '#1f2a44',
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14
  },
  working: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 28,
    paddingTop: 60
  },
  progressTrack: {
    backgroundColor: '#dfe6f1',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
    width: '100%'
  },
  progressFill: {
    backgroundColor: ACCENT,
    height: '100%'
  },
  scanner: {
    backgroundColor: '#000000',
    flex: 1
  },
  scannerOverlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'space-between',
    padding: 24
  },
  scannerHint: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 10,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 10,
    textAlign: 'center'
  },
  scannerClose: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 12
  },
  scannerCloseText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700'
  }
})

const darkStyles = StyleSheet.create({
  page: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  text: {
    color: BROWSER_PALETTES.dark.text
  },
  muted: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  heroIcon: {
    backgroundColor: '#23324a'
  },
  rowDivider: {
    borderTopColor: BROWSER_PALETTES.dark.border
  },
  sheetHeader: {
    borderBottomColor: BROWSER_PALETTES.dark.border
  },
  segmented: {
    backgroundColor: BROWSER_PALETTES.dark.surface
  },
  segmentSelected: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  secondaryButton: {
    backgroundColor: BROWSER_PALETTES.dark.surface,
    borderColor: BROWSER_PALETTES.dark.border
  },
  codeBox: {
    backgroundColor: BROWSER_PALETTES.dark.surface
  },
  input: {
    backgroundColor: BROWSER_PALETTES.dark.surface,
    borderColor: BROWSER_PALETTES.dark.border,
    color: BROWSER_PALETTES.dark.text
  },
  progressTrack: {
    backgroundColor: BROWSER_PALETTES.dark.button
  }
})
