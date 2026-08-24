import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'

import {
  RPC_HYPER_LIBRARY_LIST,
  RPC_HYPER_LIBRARY_UPLOAD
} from '../../backend/rpc/commands.mjs'
import {
  parseHyperdriveRecents,
  recordHyperdriveRecent,
  removeHyperdriveRecent,
  serializeHyperdriveRecents
} from './recents.mjs'

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const RECENTS_FILE = new File(Paths.document, 'hyperdrive-recents.json')
const hyperdriveIcon = require('../../assets/images/hyperdrive.png')

type HyperdriveItem = {
  type: 'directory' | 'file'
  name: string
  url: string
  path?: string
  byteLength?: number
  openedAt?: number
}

type Props = {
  isDark: boolean
  onCallRpc: (command: number, data?: Record<string, unknown>) => Promise<any>
  onOpenUrl: (url: string) => void
  onStatus: (message: string) => void
}

type Palette = typeof lightPalette

type ActionCardProps = {
  title: string
  description: string
  disabled: boolean
  loading: boolean
  palette: Palette
  onPress: () => void
}

export function HyperdriveScreen ({ isDark, onCallRpc, onOpenUrl, onStatus }: Props) {
  const [recents, setRecents] = useState<HyperdriveItem[]>(loadRecents)
  const [items, setItems] = useState<HyperdriveItem[] | null>(null)
  const [location, setLocation] = useState<HyperdriveItem | null>(null)
  const [listingTruncated, setListingTruncated] = useState(false)
  const [fetchUrl, setFetchUrl] = useState('')
  const [fetchVisible, setFetchVisible] = useState(false)
  const [busyAction, setBusyAction] = useState<'upload' | 'fetch' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const scanHandledRef = useRef(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const palette = isDark ? darkPalette : lightPalette
  const visibleItems = items ?? recents
  const heading = items ? location?.name || 'Files' : 'Recent'

  async function uploadFile () {
    if (busyAction) return
    const selection = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false
    })
    if (selection.canceled || !selection.assets[0]) return

    const asset = selection.assets[0]
    const file = new File(asset.uri)
    const fileSize = asset.size ?? file.size
    if (!Number.isSafeInteger(fileSize) || !fileSize || fileSize > MAX_UPLOAD_BYTES) {
      setError('Choose a file up to 10 MB.')
      return
    }

    setBusyAction('upload')
    setError(null)
    try {
      const contentBase64 = await file.base64()
      const response = await onCallRpc(RPC_HYPER_LIBRARY_UPLOAD, {
        name: asset.name,
        contentBase64
      })
      if (!response.ok || !response.item) throw new Error(response.error || 'Upload failed.')
      remember(response.item)
      onStatus(`Uploaded ${response.item.name}`)
      Alert.alert('Uploaded to Hyperdrive', response.item.url, [
        { text: 'Done' },
        { text: 'Open', onPress: () => onOpenUrl(response.item.url) }
      ])
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError))
    } finally {
      setBusyAction(null)
    }
  }

  async function fetchLocation (targetUrl = fetchUrl) {
    if (busyAction) return
    const normalizedUrl = targetUrl.trim()
    if (!normalizedUrl.toLowerCase().startsWith('hyper://')) {
      setError('Enter a valid hyper:// URL.')
      return
    }

    setBusyAction('fetch')
    setError(null)
    try {
      const response = await onCallRpc(RPC_HYPER_LIBRARY_LIST, { url: normalizedUrl })
      if (!response.ok || !response.location) throw new Error(response.error || 'Unable to fetch Hyper data.')
      remember(response.location)
      setFetchUrl(response.location.url)
      setFetchVisible(false)
      if (response.location.type === 'directory') {
        setLocation(response.location)
        setItems(Array.isArray(response.items) ? response.items : [])
        setListingTruncated(response.truncated === true)
      } else {
        onOpenUrl(response.location.url)
      }
      onStatus(`Fetched ${response.location.name}`)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
    } finally {
      setBusyAction(null)
    }
  }

  async function openItem (item: HyperdriveItem) {
    if (item.type === 'directory') {
      await fetchLocation(item.url)
      return
    }
    remember(item)
    onOpenUrl(item.url)
  }

  function remember (item: HyperdriveItem) {
    setRecents((current) => {
      const next = recordHyperdriveRecent(current, item) as HyperdriveItem[]
      if (!persistRecents(next)) reportPersistenceFailure()
      return next
    })
  }

  function removeRecent (item: HyperdriveItem) {
    if (items) return
    Alert.alert('Remove from Recent?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setRecents((current) => {
          const next = removeHyperdriveRecent(current, item.url) as HyperdriveItem[]
          if (!persistRecents(next)) reportPersistenceFailure()
          return next
        })
      }
    ])
  }

  async function openScanner () {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission()
    if (!permission.granted) {
      setError('Camera permission is required to scan a Hyper URL.')
      return
    }
    scanHandledRef.current = false
    setIsScanning(true)
  }

  function reportPersistenceFailure () {
    setTimeout(() => setError('Recent items could not be saved on this device.'), 0)
  }

  const cards = visibleItems.map((item) => (
    <Pressable
      key={item.url}
      accessibilityRole='button'
      accessibilityLabel={`${item.type === 'directory' ? 'Folder' : 'File'} ${item.name}`}
      onLongPress={() => removeRecent(item)}
      onPress={() => void openItem(item)}
      style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
    >
      {item.type === 'directory'
        ? <FolderIcon color={palette.folder} />
        : <FilePreview item={item} palette={palette} />}
      <Text numberOfLines={2} style={[styles.itemName, { color: palette.text }]}>{item.name}</Text>
      {item.type === 'file' && (
        <Text style={[styles.itemMeta, { color: palette.muted }]}>{formatBytes(item.byteLength || 0)}</Text>
      )}
    </Pressable>
  ))

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <View style={styles.actions}>
        <ActionCard
          title='Upload'
          description='Add a file to your Hyperdrive'
          disabled={Boolean(busyAction)}
          loading={busyAction === 'upload'}
          palette={palette}
          onPress={() => void uploadFile()}
        />
        <ActionCard
          title='Fetch'
          description='Open a Hyper URL or scan QR'
          disabled={Boolean(busyAction)}
          loading={busyAction === 'fetch'}
          palette={palette}
          onPress={() => setFetchVisible((visible) => !visible)}
        />
      </View>

      {fetchVisible && (
        <View style={[styles.fetchBox, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <TextInput
            autoCapitalize='none'
            autoCorrect={false}
            placeholder='hyper://...'
            placeholderTextColor={palette.muted}
            value={fetchUrl}
            onChangeText={setFetchUrl}
            onSubmitEditing={() => void fetchLocation()}
            style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          />
          <View style={styles.fetchActions}>
            <Pressable style={[styles.smallButton, { borderColor: palette.border }]} onPress={() => void openScanner()}>
              <Text style={[styles.smallButtonText, { color: palette.text }]}>Scan QR</Text>
            </Pressable>
            <Pressable style={styles.fetchButton} onPress={() => void fetchLocation()}>
              <Text style={styles.fetchButtonText}>Fetch</Text>
            </Pressable>
          </View>
        </View>
      )}

      {error && <Text selectable style={styles.error}>{error}</Text>}

      <View style={styles.libraryHeader}>
        {items && (
          <Pressable
            accessibilityRole='button'
            onPress={() => {
              setItems(null)
              setLocation(null)
              setListingTruncated(false)
            }}
          >
            <Text style={styles.back}>Back</Text>
          </Pressable>
        )}
        <Text style={[styles.heading, { color: palette.text }]}>{heading}</Text>
      </View>
      {listingTruncated && (
        <Text style={[styles.limitNote, { color: palette.muted }]}>Showing the first 100 items.</Text>
      )}

      <View style={styles.grid}>
        {visibleItems.length > 0
          ? cards
          : (
            <View style={styles.empty}>
              <Image source={hyperdriveIcon} style={styles.emptyIcon} />
              <Text style={[styles.emptyTitle, { color: palette.text }]}>Nothing here yet</Text>
              <Text style={[styles.emptyCopy, { color: palette.muted }]}>Upload a file or fetch a Hyper URL to get started.</Text>
            </View>
            )}
      </View>

      <Modal visible={isScanning} animationType='slide' onRequestClose={() => setIsScanning(false)}>
        <View style={styles.scanner}>
          {isScanning && (
            <CameraView
              style={StyleSheet.absoluteFillObject}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (scanHandledRef.current) return
                scanHandledRef.current = true
                setIsScanning(false)
                setFetchUrl(data)
                void fetchLocation(data)
              }}
            />
          )}
          <Pressable style={styles.scannerClose} onPress={() => setIsScanning(false)}>
            <Text style={styles.scannerCloseText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

function ActionCard ({ title, description, disabled, loading, palette, onPress }: ActionCardProps) {
  return (
    <Pressable
      accessibilityRole='button'
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: palette.card, borderColor: palette.border },
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null
      ]}
    >
      {loading ? <ActivityIndicator color='#4b93f7' /> : <Text style={styles.actionSymbol}>{title === 'Upload' ? '+' : '->'}</Text>}
      <Text style={[styles.actionTitle, { color: palette.text }]}>{title}</Text>
      <Text style={[styles.actionCopy, { color: palette.muted }]}>{description}</Text>
    </Pressable>
  )
}

function FolderIcon ({ color }: { color: string }) {
  return (
    <View style={styles.folderWrap}>
      <View style={[styles.folderTab, { backgroundColor: color }]} />
      <View style={[styles.folderBody, { backgroundColor: color }]} />
    </View>
  )
}

function FilePreview ({ item, palette }: { item: HyperdriveItem, palette: Palette }) {
  const extension = item.name.includes('.') ? item.name.split('.').pop()?.slice(0, 5).toUpperCase() : 'FILE'
  return (
    <View style={[styles.filePreview, { backgroundColor: palette.file }]}>
      <View style={[styles.fileFold, { borderTopColor: palette.background }]} />
      <Text style={[styles.fileExtension, { color: palette.text }]}>{extension}</Text>
    </View>
  )
}

function loadRecents (): HyperdriveItem[] {
  try {
    return RECENTS_FILE.exists
      ? parseHyperdriveRecents(RECENTS_FILE.textSync()) as HyperdriveItem[]
      : []
  } catch {
    return []
  }
}

function persistRecents (recents: HyperdriveItem[]) {
  try {
    if (!RECENTS_FILE.exists) RECENTS_FILE.create({ intermediates: true })
    RECENTS_FILE.write(serializeHyperdriveRecents(recents))
    return true
  } catch {
    return false
  }
}

function formatBytes (bytes: number) {
  if (!bytes) return 'File'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const lightPalette = {
  background: '#f5f7fb', card: '#ffffff', border: '#dce3ee', text: '#172033', muted: '#68758a', folder: '#68d7cb', file: '#e7edf6'
}
const darkPalette = {
  background: '#17191d', card: '#23262c', border: '#363b45', text: '#f2f3f5', muted: '#a9b0bd', folder: '#68d7cb', file: '#303640'
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18, paddingTop: 6 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, minHeight: 126, borderWidth: 1, borderRadius: 18, padding: 16, justifyContent: 'flex-end' },
  actionSymbol: { color: '#4b93f7', fontSize: 30, fontWeight: '400', lineHeight: 34 },
  actionTitle: { fontSize: 19, fontWeight: '700', marginTop: 5 },
  actionCopy: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  fetchBox: { borderWidth: 1, borderRadius: 16, marginTop: 12, padding: 12 },
  input: { borderWidth: 1, borderRadius: 11, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  fetchActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 10 },
  smallButton: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  smallButtonText: { fontSize: 14, fontWeight: '600' },
  fetchButton: { backgroundColor: '#2879df', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  fetchButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  error: { color: '#d84b64', fontSize: 13, lineHeight: 18, marginTop: 10 },
  libraryHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6, marginTop: 24 },
  heading: { fontSize: 21, fontWeight: '700' },
  back: { color: '#4b93f7', fontSize: 15, fontWeight: '700' },
  limitNote: { fontSize: 12, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 36 },
  item: { width: '33.333%', minHeight: 142, alignItems: 'center', paddingHorizontal: 7, paddingVertical: 12 },
  itemName: { fontSize: 14, fontWeight: '600', lineHeight: 18, marginTop: 8, textAlign: 'center' },
  itemMeta: { fontSize: 11, marginTop: 3 },
  folderWrap: { width: 76, height: 62, justifyContent: 'flex-end' },
  folderTab: { borderTopLeftRadius: 7, borderTopRightRadius: 7, height: 15, left: 4, position: 'absolute', top: 2, width: 34 },
  folderBody: { borderRadius: 11, height: 51, width: 76 },
  filePreview: { width: 70, height: 76, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fileFold: { position: 'absolute', right: 0, top: 0, width: 0, height: 0, borderLeftWidth: 17, borderTopWidth: 17, borderLeftColor: 'transparent' },
  fileExtension: { fontSize: 13, fontWeight: '800' },
  empty: { alignItems: 'center', paddingHorizontal: 30, paddingTop: 42, width: '100%' },
  emptyIcon: { height: 70, width: 70, borderRadius: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 13 },
  emptyCopy: { fontSize: 14, lineHeight: 20, marginTop: 5, textAlign: 'center' },
  scanner: { backgroundColor: '#000000', flex: 1 },
  scannerClose: { alignSelf: 'flex-end', backgroundColor: 'rgba(0,0,0,.65)', borderRadius: 999, margin: 20, paddingHorizontal: 18, paddingVertical: 10 },
  scannerCloseText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 }
})
