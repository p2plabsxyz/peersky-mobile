import { useEffect, useState, useRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as DocumentPicker from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import CopyIcon from '../../assets/icons/bootstrap/copy.svg'
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
const hyperdriveIcon = require('../../assets/images/hyperdrive.png')

type RecentSource = 'fetched' | 'uploaded'
type RecentFilter = 'all' | RecentSource
type UploadVisibility = 'public' | 'private'

type HyperdriveItem = {
  type: 'directory' | 'file'
  name: string
  url: string
  path?: string
  byteLength?: number
  openedAt?: number
  source?: RecentSource
  visibility?: UploadVisibility
  children?: HyperdriveItem[]
}

type Props = {
  isDark: boolean
  isLandscape: boolean
  onCallRpc: (command: number, data?: Record<string, unknown>) => Promise<any>
  onOpenUrl: (url: string) => void
  onStatus: (message: string) => void
}

type Palette = typeof lightPalette

const RECENT_FILTERS: Array<{ id: RecentFilter, label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'uploaded', label: 'Uploaded' },
  { id: 'fetched', label: 'Fetched' }
]

export function HyperdriveScreen ({ isDark, isLandscape, onCallRpc, onOpenUrl, onStatus }: Props) {
  const [recents, setRecents] = useState<HyperdriveItem[]>(loadRecents)
  const [items, setItems] = useState<HyperdriveItem[] | null>(null)
  const [location, setLocation] = useState<HyperdriveItem | null>(null)
  const [listingTruncated, setListingTruncated] = useState(false)
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all')
  const [filterVisible, setFilterVisible] = useState(false)
  const [fetchUrl, setFetchUrl] = useState('')
  const [busyAction, setBusyAction] = useState<'upload' | 'fetch' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const scanHandledRef = useRef(false)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const palette = isDark ? darkPalette : lightPalette
  const visibleItems = items ?? recents.filter((item) => recentFilter === 'all' || item.source === recentFilter)
  const heading = items ? location?.name || 'Files' : 'Recent'
  const filterLabel = RECENT_FILTERS.find((filter) => filter.id === recentFilter)?.label || 'All'

  useEffect(() => {
    if (!persistRecents(recents)) {
      setError('Recent items could not be saved on this device.')
    }
  }, [recents])

  function chooseUploadVisibility () {
    if (busyAction) return
    Alert.alert(
      'Choose upload visibility',
      'Public files can be shared, and anyone with one public link may browse other files in your public drive. Private files stay on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Private', onPress: () => void uploadFile('private') },
        { text: 'Public', onPress: () => void uploadFile('public') }
      ]
    )
  }

  async function uploadFile (visibility: UploadVisibility) {
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
    setNotice(null)
    try {
      const contentBase64 = await file.base64()
      const response = await onCallRpc(RPC_HYPER_LIBRARY_UPLOAD, {
        name: asset.name,
        contentBase64,
        visibility
      })
      if (!response.ok || !response.item) throw new Error(response.error || 'Upload failed.')
      remember(response.item, 'uploaded')
      onStatus(`Uploaded ${response.item.name}`)
      const uploadMessage = visibility === 'private'
        ? 'Stored privately on this device.'
        : response.item.url
      Alert.alert('Uploaded to Hyperdrive', uploadMessage, [
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
    setNotice(null)
    try {
      const response = await onCallRpc(RPC_HYPER_LIBRARY_LIST, { url: normalizedUrl })
      if (!response.ok || !response.location) throw new Error(response.error || 'Unable to fetch Hyper data.')
      const fetchedItems = Array.isArray(response.items) ? response.items : []
      remember({
        ...response.location,
        children: response.location.type === 'directory' ? fetchedItems : undefined
      }, 'fetched')
      setFetchUrl(response.location.url)
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
      if (item.type === 'directory') {
        if (item.children) {
          remember(item, item.source || 'fetched')
          setLocation(item)
          setItems(item.children)
          setListingTruncated(false)
        } else {
          await fetchLocation(item.url)
        }
        return
      }
      remember(item, item.source || 'fetched')
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
    setRecents((current) => recordHyperdriveRecent(
      current,
      { ...item, source }
    ) as HyperdriveItem[])
  }

  function removeRecent (item: HyperdriveItem) {
    if (items) return
    Alert.alert('Remove from Recent?', item.name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setRecents((current) => removeHyperdriveRecent(
          current,
          item.url
        ) as HyperdriveItem[])
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

  function copyItemUrl (item: HyperdriveItem) {
    try {
      Clipboard.setString(item.url)
      setError(null)
      setNotice('Hyper URL copied.')
      onStatus(`Copied ${item.name} URL`)
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError))
    }
  }

  const libraryItems = visibleItems.length > 0
    ? visibleItems.map((item) => (
      <View key={item.url} style={[styles.item, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`${item.type === 'directory' ? 'Folder' : 'File'} ${item.name}`}
          onLongPress={() => removeRecent(item)}
          onPress={() => void openItem(item)}
          style={({ pressed }) => [styles.itemOpen, pressed ? styles.pressed : null]}
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
        {item.visibility !== 'private' && (
          <Pressable
            accessibilityLabel={`Copy ${item.name} Hyper URL`}
            accessibilityRole='button'
            hitSlop={6}
            onPress={() => copyItemUrl(item)}
            style={({ pressed }) => [styles.copyButton, pressed ? styles.pressed : null]}
          >
            <CopyIcon width={18} height={18} color={palette.secondaryText} />
          </Pressable>
        )}
      </View>
    ))
    : (
      <View style={styles.empty}>
        <Image source={hyperdriveIcon} style={styles.emptyIcon} />
        <Text style={[styles.emptyTitle, { color: palette.text }]}>Nothing here yet</Text>
        <Text style={[styles.emptyCopy, { color: palette.muted }]}>Upload a file or fetch a Hyper URL to get started.</Text>
      </View>
      )

  const pageContent = (
    <>
      <View style={styles.appHeader}>
        <Image source={hyperdriveIcon} style={styles.appIcon} />
        <View style={styles.appHeaderCopy}>
          <Text style={[styles.appTitle, { color: palette.text }]}>Hyperdrive</Text>
          <Text style={[styles.helperText, { color: palette.muted }]}>Upload and fetch files over Hyper.</Text>
        </View>
        <Text style={[styles.readyPill, { color: palette.pillText, backgroundColor: palette.pill }]}>ready</Text>
      </View>

      <View style={styles.setupBlock}>
        <Text style={[styles.setupTitle, { color: palette.text }]}>Upload a file</Text>
        <Text style={[styles.helperText, { color: palette.muted }]}>Publish a file up to 10 MB from this device.</Text>
        <Pressable
          accessibilityRole='button'
          disabled={Boolean(busyAction)}
          onPress={chooseUploadVisibility}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: palette.accent }, pressed ? styles.pressed : null, busyAction ? styles.disabled : null]}
        >
          {busyAction === 'upload' ? <ActivityIndicator color='#ffffff' /> : <UploadIcon width={20} height={20} color='#ffffff' />}
          <Text style={styles.primaryActionText}>Choose file</Text>
        </Pressable>
      </View>

      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: palette.border }]} />
        <Text style={[styles.dividerText, { color: palette.muted }]}>or fetch</Text>
        <View style={[styles.dividerLine, { backgroundColor: palette.border }]} />
      </View>

      <View style={styles.setupBlock}>
        <Text style={[styles.fieldLabel, { color: palette.muted }]}>Hyper address</Text>
        <Text style={[styles.helperText, { color: palette.muted }]}>Paste a hyper:// URL or scan one from another device.</Text>
        <TextInput
          autoCapitalize='none'
          autoCorrect={false}
          placeholder='hyper://...'
          placeholderTextColor={palette.placeholder}
          value={fetchUrl}
          onChangeText={setFetchUrl}
          onSubmitEditing={() => void fetchLocation()}
          style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}
        />
        <View style={styles.fetchActions}>
          <Pressable
            accessibilityRole='button'
            disabled={Boolean(busyAction)}
            style={({ pressed }) => [styles.secondaryAction, { borderColor: palette.border }, pressed ? styles.pressed : null, busyAction ? styles.disabled : null]}
            onPress={() => void openScanner()}
          >
            <Text style={[styles.secondaryActionText, { color: palette.secondaryText }]}>Scan QR</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            disabled={Boolean(busyAction) || !fetchUrl.trim()}
            style={({ pressed }) => [styles.fetchButton, { backgroundColor: palette.fetch }, pressed ? styles.pressed : null, busyAction || !fetchUrl.trim() ? styles.disabled : null]}
            onPress={() => void fetchLocation()}
          >
            {busyAction === 'fetch' ? <ActivityIndicator color={palette.fetchText} /> : <DownloadIcon width={19} height={19} color={palette.fetchText} />}
            <Text style={[styles.fetchButtonText, { color: palette.fetchText }]}>Fetch</Text>
          </Pressable>
        </View>
      </View>

      {error && <Text selectable style={styles.error}>{error}</Text>}
      {notice && <Text style={[styles.notice, { color: palette.noticeText, backgroundColor: palette.notice }]}>{notice}</Text>}

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
          <View style={styles.dropdownWrap}>
            <Pressable
              accessibilityLabel={`Filter Recent, currently ${filterLabel}`}
              accessibilityRole='button'
              accessibilityState={{ expanded: filterVisible }}
              onPress={() => setFilterVisible((visible) => !visible)}
              style={({ pressed }) => [styles.filterButton, { backgroundColor: palette.surface, borderColor: palette.border }, pressed ? styles.pressed : null]}
            >
              <Text style={[styles.filterLabel, { color: palette.text }]}>{filterLabel}</Text>
              <ChevronRightIcon width={14} height={14} color={palette.muted} style={styles.dropdownChevron} />
            </Pressable>
            {filterVisible && (
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
            )}
          </View>
        )}
      </View>
      {listingTruncated && <Text style={[styles.limitNote, { color: palette.muted }]}>Showing a partial directory listing.</Text>}

      {isLandscape
        ? <View style={styles.listContent}>{libraryItems}</View>
        : (
          <ScrollView
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps='handled'
            style={styles.list}
          >
            {libraryItems}
          </ScrollView>
          )}

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
          <SafeAreaView style={styles.scannerOverlay} edges={['top', 'right', 'bottom', 'left']}>
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
          </SafeAreaView>
        </View>
      </Modal>
    </>
  )

  if (isLandscape) {
    return (
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps='handled'
        style={[styles.pageScroll, { backgroundColor: palette.background }]}
      >
        {pageContent}
      </ScrollView>
    )
  }

  return <View style={[styles.page, styles.pageFixed, { backgroundColor: palette.background }]}>{pageContent}</View>
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
      <View style={[styles.fileFold, { borderTopColor: palette.surface }]} />
      <Text style={[styles.fileExtension, { color: palette.text }]}>{extension}</Text>
    </View>
  )
}

function loadRecents (): HyperdriveItem[] {
  try {
    const file = getRecentsFile()
    return file.exists ? parseHyperdriveRecents(file.textSync()) as HyperdriveItem[] : []
  } catch {
    return []
  }
}

function persistRecents (recents: HyperdriveItem[]) {
  try {
    const file = getRecentsFile()
    if (!file.exists) file.create({ intermediates: true })
    file.write(serializeHyperdriveRecents(recents))
    return true
  } catch {
    return false
  }
}

function getRecentsFile () {
  return new File(Paths.document, 'hyperdrive-recents.json')
}

function formatItemMeta (item: HyperdriveItem) {
  return item.type === 'directory' ? 'Folder' : formatBytes(item.byteLength || 0)
}

function formatRecentMeta (item: HyperdriveItem) {
  const source = item.source === 'uploaded' ? 'Uploaded' : 'Fetched'
  const visibility = item.visibility === 'private'
    ? 'Private'
    : item.visibility === 'public' ? 'Public' : null
  const details = visibility ? `${source} - ${visibility}` : source
  if (!item.openedAt) return details
  return `${details} - ${new Date(item.openedAt).toLocaleDateString()}`
}

function formatBytes (bytes: number) {
  if (!bytes) return 'File'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const lightPalette = {
  background: '#f5f7fb', surface: '#ffffff', border: '#dce3ee', text: '#172033', muted: '#68758a', placeholder: '#8b96a8', accent: '#2f80ed', secondaryText: '#286fc9', fetch: '#dff5e9', fetchText: '#226346', notice: '#e5f2ff', noticeText: '#245d9d', pill: '#e5ecff', pillText: '#40558c', folder: '#68d7cb', file: '#e7edf6'
}
const darkPalette = {
  background: '#1f2027', surface: '#262832', border: '#383b46', text: '#f1f2f7', muted: '#a2a8bb', placeholder: '#6f7484', accent: '#2f80ed', secondaryText: '#9ec5ff', fetch: '#1d513d', fetchText: '#c6f6df', notice: '#203a56', noticeText: '#c7e2ff', pill: '#30364a', pillText: '#cdd6ff', folder: '#68d7cb', file: '#30333f'
}

const styles = StyleSheet.create({
  page: { gap: 18, paddingHorizontal: 18, paddingTop: 12 },
  pageFixed: { flex: 1 },
  pageScroll: { flex: 1 },
  appHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  appIcon: { borderRadius: 10, height: 44, width: 44 },
  appHeaderCopy: { flex: 1, gap: 3 },
  appTitle: { fontSize: 18, fontWeight: '700' },
  readyPill: { borderRadius: 999, fontSize: 12, fontWeight: '700', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4 },
  helperText: { fontSize: 13, lineHeight: 19 },
  setupBlock: { gap: 10 },
  setupTitle: { fontSize: 15, fontWeight: '700' },
  fieldLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  primaryAction: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 9, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 12 },
  primaryActionText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  dividerRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginVertical: 2 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 14, paddingHorizontal: 12, paddingVertical: 11 },
  fetchActions: { flexDirection: 'row', gap: 10 },
  secondaryAction: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14 },
  secondaryActionText: { fontSize: 13, fontWeight: '800' },
  fetchButton: { alignItems: 'center', borderRadius: 10, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14 },
  fetchButtonText: { fontSize: 14, fontWeight: '800' },
  error: { backgroundColor: '#4b2430', borderColor: '#8f4c60', borderRadius: 10, borderWidth: 1, color: '#ffd6df', fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingVertical: 10 },
  notice: { borderRadius: 10, fontSize: 13, fontWeight: '600', paddingHorizontal: 12, paddingVertical: 10 },
  libraryHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 46, zIndex: 20 },
  heading: { flex: 1, fontSize: 20, fontWeight: '700' },
  backButton: { alignItems: 'center', height: 40, justifyContent: 'center', marginRight: 6, width: 34 },
  dropdownWrap: { position: 'relative', zIndex: 30 },
  filterButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 9, minWidth: 112, paddingHorizontal: 12, paddingVertical: 9 },
  filterLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  dropdownChevron: { transform: [{ rotate: '90deg' }] },
  filterMenu: { borderRadius: 10, borderWidth: 1, elevation: 8, minWidth: 140, overflow: 'hidden', position: 'absolute', right: 0, shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, top: 44, zIndex: 40 },
  filterOption: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  filterOptionLabel: { fontSize: 14, fontWeight: '600' },
  limitNote: { fontSize: 12, marginBottom: 4 },
  list: { flex: 1 },
  listContent: { gap: 8, paddingBottom: 36 },
  item: { alignItems: 'center', borderRadius: 10, borderWidth: 1, flexDirection: 'row', minHeight: 62 },
  itemOpen: { alignItems: 'center', flex: 1, flexDirection: 'row', minHeight: 60, paddingLeft: 12, paddingVertical: 8 },
  itemCopy: { flex: 1, gap: 4, marginHorizontal: 13 },
  itemName: { fontSize: 15, fontWeight: '600' },
  itemMeta: { fontSize: 12 },
  copyButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
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
  scanner: { backgroundColor: '#000000', flex: 1 },
  scannerOverlay: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  scanGuide: { height: 240, width: 240 },
  scanCorner: { borderColor: '#ffffff', height: 42, position: 'absolute', width: 42 },
  scanTopLeft: { borderLeftWidth: 4, borderTopWidth: 4, left: 0, top: 0 },
  scanTopRight: { borderRightWidth: 4, borderTopWidth: 4, right: 0, top: 0 },
  scanBottomLeft: { borderBottomWidth: 4, borderLeftWidth: 4, bottom: 0, left: 0 },
  scanBottomRight: { borderBottomWidth: 4, borderRightWidth: 4, bottom: 0, right: 0 },
  scanHint: { color: '#ffffff', fontSize: 14, marginTop: 24, textAlign: 'center' },
  scannerClose: { backgroundColor: 'rgba(0,0,0,.65)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, position: 'absolute', right: 16, top: 12 },
  scannerCloseText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.62 },
  disabled: { opacity: 0.5 }
})
