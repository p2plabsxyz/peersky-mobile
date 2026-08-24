import { useState, useRef } from 'react'
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
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import DownloadIcon from '../../assets/icons/bootstrap/download.svg'
import UploadIcon from '../../assets/icons/bootstrap/arrow-bar-up.svg'

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

type RecentSource = 'fetched' | 'uploaded'
type RecentFilter = 'all' | RecentSource

type HyperdriveItem = {
  type: 'directory' | 'file'
  name: string
  url: string
  path?: string
  byteLength?: number
  openedAt?: number
  source?: RecentSource
  children?: HyperdriveItem[]
}

type Props = {
  isDark: boolean
  onCallRpc: (command: number, data?: Record<string, unknown>) => Promise<any>
  onOpenUrl: (url: string) => void
  onStatus: (message: string) => void
}

type Palette = typeof lightPalette

type ActionButtonProps = {
  icon: 'fetch' | 'upload'
  title: string
  disabled: boolean
  loading: boolean
  palette: Palette
  onPress: () => void
}

const RECENT_FILTERS: Array<{ id: RecentFilter, label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'fetched', label: 'Fetched' }
]

export function HyperdriveScreen ({ isDark, onCallRpc, onOpenUrl, onStatus }: Props) {
  const [recents, setRecents] = useState<HyperdriveItem[]>(loadRecents)
  const [items, setItems] = useState<HyperdriveItem[] | null>(null)
  const [location, setLocation] = useState<HyperdriveItem | null>(null)
  const [listingTruncated, setListingTruncated] = useState(false)
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all')
  const [filterVisible, setFilterVisible] = useState(false)
  const [fetchUrl, setFetchUrl] = useState('')
  const [fetchVisible, setFetchVisible] = useState(false)
  const [busyAction, setBusyAction] = useState<'upload' | 'fetch' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const scanHandledRef = useRef(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const palette = isDark ? darkPalette : lightPalette
  const visibleItems = items ?? recents.filter((item) => recentFilter === 'all' || item.source === recentFilter)
  const heading = items ? location?.name || 'Files' : 'Recent'
  const filterLabel = RECENT_FILTERS.find((filter) => filter.id === recentFilter)?.label || 'All'

  async function uploadFile () {
    if (busyAction) return
    const selection = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
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
      const response = await onCallRpc(RPC_HYPER_LIBRARY_UPLOAD, { name: asset.name, contentBase64 })
      if (!response.ok || !response.item) throw new Error(response.error || 'Upload failed.')
      remember(response.item, 'uploaded')
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
      const fetchedItems = Array.isArray(response.items) ? response.items : []
      remember({
        ...response.location,
        children: response.location.type === 'directory' ? fetchedItems : undefined
      }, 'fetched')
      setFetchUrl(response.location.url)
      setFetchVisible(false)
      if (response.location.type === 'directory') {
        setLocation(response.location)
        setItems(fetchedItems)
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
    if (!items) {
      remember(item, item.source || 'fetched')
      if (item.type === 'directory' && item.children) {
        setLocation(item)
        setItems(item.children)
        setListingTruncated(false)
        return
      }
      onOpenUrl(item.url)
      return
    }

    if (item.type === 'directory') {
      await fetchLocation(item.url)
      return
    }
    remember(item, 'fetched')
    onOpenUrl(item.url)
  }

  function remember (item: HyperdriveItem, source: RecentSource) {
    setRecents((current) => {
      const next = recordHyperdriveRecent(current, { ...item, source }) as HyperdriveItem[]
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
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission()
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

  return (
    <View style={[styles.page, { backgroundColor: palette.background }]}>
      <View style={[styles.actions, { borderBottomColor: palette.border }]}>
        <ActionButton icon='upload' title='Upload file' disabled={Boolean(busyAction)} loading={busyAction === 'upload'} palette={palette} onPress={() => void uploadFile()} />
        <View style={[styles.actionDivider, { backgroundColor: palette.border }]} />
        <ActionButton icon='fetch' title='Fetch Hyper URL' disabled={Boolean(busyAction)} loading={busyAction === 'fetch'} palette={palette} onPress={() => setFetchVisible((visible) => !visible)} />
      </View>

      {fetchVisible && (
        <View style={[styles.fetchBox, { borderBottomColor: palette.border }]}>
          <TextInput
            autoCapitalize='none'
            autoCorrect={false}
            placeholder='hyper://...'
            placeholderTextColor={palette.muted}
            value={fetchUrl}
            onChangeText={setFetchUrl}
            onSubmitEditing={() => void fetchLocation()}
            style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]}
          />
          <View style={styles.fetchActions}>
            <Pressable style={styles.textButton} onPress={() => void openScanner()}>
              <Text style={[styles.textButtonLabel, { color: palette.accent }]}>Scan QR</Text>
            </Pressable>
            <Pressable style={[styles.fetchButton, { backgroundColor: palette.accent }]} onPress={() => void fetchLocation()}>
              <Text style={styles.fetchButtonText}>Fetch</Text>
            </Pressable>
          </View>
        </View>
      )}

      {error && <Text selectable style={styles.error}>{error}</Text>}

      <View style={styles.libraryHeader}>
        {items && (
          <Pressable
            accessibilityLabel='Back to Recent'
            accessibilityRole='button'
            hitSlop={8}
            onPress={() => {
              setItems(null)
              setLocation(null)
              setListingTruncated(false)
            }}
            style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
          >
            <ArrowLeftIcon width={20} height={20} color={palette.text} />
          </Pressable>
        )}
        <Text numberOfLines={1} style={[styles.heading, { color: palette.text }]}>{heading}</Text>
        {!items && recents.length > 0 && (
          <Pressable accessibilityLabel={`Filter Recent, currently ${filterLabel}`} accessibilityRole='button' onPress={() => setFilterVisible(true)} style={({ pressed }) => [styles.filterButton, pressed ? styles.pressed : null]}>
            <Text style={[styles.filterLabel, { color: palette.accent }]}>{filterLabel} v</Text>
          </Pressable>
        )}
      </View>
      {listingTruncated && <Text style={[styles.limitNote, { color: palette.muted }]}>Showing the first 100 items.</Text>}

      <View style={styles.list}>
        {visibleItems.length > 0
          ? visibleItems.map((item) => (
            <Pressable
              key={item.url}
              accessibilityRole='button'
              accessibilityLabel={`${item.type === 'directory' ? 'Folder' : 'File'} ${item.name}`}
              onLongPress={() => removeRecent(item)}
              onPress={() => void openItem(item)}
              style={({ pressed }) => [styles.item, { borderBottomColor: palette.border }, pressed ? styles.pressed : null]}
            >
              {item.type === 'directory' ? <FolderIcon color={palette.folder} /> : <FilePreview item={item} palette={palette} />}
              <View style={styles.itemCopy}>
                <Text numberOfLines={1} style={[styles.itemName, { color: palette.text }]}>{item.name}</Text>
                <Text numberOfLines={1} style={[styles.itemMeta, { color: palette.muted }]}>
                  {items ? formatItemMeta(item) : formatRecentMeta(item)}
                </Text>
              </View>
              <ChevronRightIcon width={18} height={18} color={palette.muted} />
            </Pressable>
          ))
          : (
            <View style={styles.empty}>
              <Image source={hyperdriveIcon} style={styles.emptyIcon} />
              <Text style={[styles.emptyTitle, { color: palette.text }]}>Nothing here yet</Text>
              <Text style={[styles.emptyCopy, { color: palette.muted }]}>Upload a file or fetch a Hyper URL to get started.</Text>
            </View>
            )}
      </View>

      <Modal transparent animationType='fade' visible={filterVisible} onRequestClose={() => setFilterVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFilterVisible(false)}>
          <View style={[styles.filterMenu, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {RECENT_FILTERS.map((filter) => (
              <Pressable
                accessibilityRole='button'
                key={filter.id}
                onPress={() => {
                  setRecentFilter(filter.id)
                  setFilterVisible(false)
                }}
                style={({ pressed }) => [styles.filterOption, pressed ? styles.pressed : null]}
              >
                <Text style={[styles.filterOptionLabel, { color: filter.id === recentFilter ? palette.accent : palette.text }]}>{filter.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={isScanning} animationType='fade' onRequestClose={() => setIsScanning(false)}>
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
          <View pointerEvents='none' style={styles.scanGuide}>
            <View style={[styles.scanCorner, styles.scanTopLeft]} />
            <View style={[styles.scanCorner, styles.scanTopRight]} />
            <View style={[styles.scanCorner, styles.scanBottomLeft]} />
            <View style={[styles.scanCorner, styles.scanBottomRight]} />
          </View>
          <Text style={styles.scanHint}>Align the Hyper QR code inside the frame</Text>
          <Pressable style={styles.scannerClose} onPress={() => setIsScanning(false)}>
            <Text style={styles.scannerCloseText}>Cancel</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  )
}

function ActionButton ({ icon, title, disabled, loading, palette, onPress }: ActionButtonProps) {
  return (
    <Pressable accessibilityRole='button' disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, pressed ? styles.pressed : null, disabled ? styles.disabled : null]}>
      {loading
        ? <ActivityIndicator size='small' color={palette.accent} />
        : icon === 'upload'
          ? <UploadIcon width={21} height={21} color={palette.accent} />
          : <DownloadIcon width={21} height={21} color={palette.accent} />}
      <Text style={[styles.actionTitle, { color: palette.text }]}>{title}</Text>
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
    return RECENTS_FILE.exists ? parseHyperdriveRecents(RECENTS_FILE.textSync()) as HyperdriveItem[] : []
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

function formatItemMeta (item: HyperdriveItem) {
  return item.type === 'directory' ? 'Folder' : formatBytes(item.byteLength || 0)
}

function formatRecentMeta (item: HyperdriveItem) {
  const source = item.source === 'uploaded' ? 'Uploaded' : 'Fetched'
  if (!item.openedAt) return source
  return `${source} - ${new Date(item.openedAt).toLocaleDateString()}`
}

function formatBytes (bytes: number) {
  if (!bytes) return 'File'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const lightPalette = {
  background: '#f5f7fb', surface: '#ffffff', border: '#dce3ee', text: '#172033', muted: '#68758a', accent: '#2879df', folder: '#68d7cb', file: '#e7edf6'
}
const darkPalette = {
  background: '#17191d', surface: '#23262c', border: '#363b45', text: '#f2f3f5', muted: '#a9b0bd', accent: '#69a9ff', folder: '#68d7cb', file: '#303640'
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18, paddingTop: 4 },
  actions: { borderBottomWidth: 1, flexDirection: 'row', minHeight: 58 },
  action: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 9, justifyContent: 'center', paddingHorizontal: 8 },
  actionDivider: { alignSelf: 'center', height: 26, width: 1 },
  actionTitle: { fontSize: 15, fontWeight: '700' },
  fetchBox: { borderBottomWidth: 1, paddingVertical: 12 },
  input: { borderRadius: 10, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  fetchActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 9 },
  textButton: { paddingHorizontal: 12, paddingVertical: 9 },
  textButtonLabel: { fontSize: 14, fontWeight: '700' },
  fetchButton: { borderRadius: 9, paddingHorizontal: 18, paddingVertical: 9 },
  fetchButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  error: { color: '#d84b64', fontSize: 13, lineHeight: 18, marginTop: 10 },
  libraryHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 56, marginTop: 8 },
  heading: { flex: 1, fontSize: 20, fontWeight: '700' },
  backButton: { alignItems: 'center', height: 40, justifyContent: 'center', marginRight: 6, width: 34 },
  filterButton: { paddingHorizontal: 8, paddingVertical: 9 },
  filterLabel: { fontSize: 14, fontWeight: '700' },
  limitNote: { fontSize: 12, marginBottom: 4 },
  list: { paddingBottom: 36 },
  item: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 68, paddingHorizontal: 4, paddingVertical: 10 },
  itemCopy: { flex: 1, gap: 4, marginHorizontal: 13 },
  itemName: { fontSize: 15, fontWeight: '600' },
  itemMeta: { fontSize: 12 },
  folderWrap: { height: 34, justifyContent: 'flex-end', width: 42 },
  folderTab: { borderTopLeftRadius: 4, borderTopRightRadius: 4, height: 8, left: 3, position: 'absolute', top: 1, width: 19 },
  folderBody: { borderRadius: 6, height: 28, width: 42 },
  filePreview: { alignItems: 'center', borderRadius: 6, height: 42, justifyContent: 'center', overflow: 'hidden', width: 40 },
  fileFold: { position: 'absolute', right: 0, top: 0, width: 0, height: 0, borderLeftWidth: 10, borderTopWidth: 10, borderLeftColor: 'transparent' },
  fileExtension: { fontSize: 9, fontWeight: '800' },
  empty: { alignItems: 'center', paddingHorizontal: 30, paddingTop: 48, width: '100%' },
  emptyIcon: { height: 58, width: 58, borderRadius: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 13 },
  emptyCopy: { fontSize: 14, lineHeight: 20, marginTop: 5, textAlign: 'center' },
  modalBackdrop: { alignItems: 'flex-end', backgroundColor: 'rgba(0,0,0,.35)', flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  filterMenu: { alignSelf: 'stretch', borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  filterOption: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 18 },
  filterOptionLabel: { fontSize: 16, fontWeight: '600' },
  scanner: { alignItems: 'center', backgroundColor: '#000000', flex: 1, justifyContent: 'center' },
  scanGuide: { height: 240, width: 240 },
  scanCorner: { borderColor: '#ffffff', height: 42, position: 'absolute', width: 42 },
  scanTopLeft: { borderLeftWidth: 4, borderTopWidth: 4, left: 0, top: 0 },
  scanTopRight: { borderRightWidth: 4, borderTopWidth: 4, right: 0, top: 0 },
  scanBottomLeft: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: 0, left: 0 },
  scanBottomRight: { borderBottomWidth: 4, borderRightWidth: 4, bottom: 0, right: 0 },
  scanHint: { color: '#ffffff', fontSize: 14, marginTop: 24, textAlign: 'center' },
  scannerClose: { backgroundColor: 'rgba(0,0,0,.65)', borderRadius: 999, position: 'absolute', right: 20, top: 20, paddingHorizontal: 18, paddingVertical: 10 },
  scannerCloseText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.62 },
  disabled: { opacity: 0.5 }
})
