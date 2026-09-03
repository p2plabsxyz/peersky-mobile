import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import DownloadIcon from '../../assets/icons/bootstrap/download.svg'
import ReloadIcon from '../../assets/icons/bootstrap/arrow-clockwise.svg'
import PauseIcon from '../../assets/icons/bootstrap/pause-fill.svg'
import PlayIcon from '../../assets/icons/bootstrap/play-fill.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { getProxiedHyperUrl, sortBrowserDownloads } from './browser-downloads.mjs'
import type { BrowserDownload } from './useBrowserDownloads'

type DownloadSort = 'newest' | 'oldest' | 'name' | 'size'

const DOWNLOAD_SORT_OPTIONS: Array<{ id: DownloadSort, label: string }> = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' }
]

type DownloadsScreenProps = {
  downloads: BrowserDownload[]
  error: string | null
  isDark: boolean
  isReady: boolean
  onClose: () => void
  onOpen: (id: string) => void
  onPause: (download: BrowserDownload) => Promise<unknown>
  onRefresh: () => void
  onRemove: (id: string) => void
  onRetry: (download: BrowserDownload) => Promise<unknown>
}

export function DownloadsScreen ({
  downloads,
  error,
  isDark,
  isReady,
  onClose,
  onOpen,
  onPause,
  onRefresh,
  onRemove,
  onRetry
}: DownloadsScreenProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const [sort, setSort] = useState<DownloadSort>('newest')
  const [isSortOpen, setIsSortOpen] = useState(false)
  const [retryingDownloadId, setRetryingDownloadId] = useState<string | null>(null)
  const [pausingDownloadId, setPausingDownloadId] = useState<string | null>(null)
  const sortedDownloads = useMemo(
    () => sortBrowserDownloads(downloads, sort) as BrowserDownload[],
    [downloads, sort]
  )

  return (
    <View style={[styles.screen, { backgroundColor: palette.shell }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable
          accessibilityLabel='Close Downloads'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
          onPress={onClose}
        >
          <ArrowLeftIcon width={22} height={22} color={palette.text} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>Downloads</Text>
        {isReady && downloads.length > 0 && (
          <Pressable
            accessibilityLabel={`Sort downloads, currently ${sort}`}
            accessibilityRole='button'
            hitSlop={8}
            style={({ pressed }) => [styles.sortButton, pressed ? styles.pressed : null]}
            onPress={() => setIsSortOpen(true)}
          >
            <Text style={[styles.sortButtonText, { color: palette.accent }]}>Sort</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityLabel='Refresh Downloads'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
          onPress={onRefresh}
        >
          <ReloadIcon width={20} height={20} color={palette.text} />
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isReady
        ? (
          <View style={styles.empty}>
            <ActivityIndicator color={palette.accent} />
            <Text style={[styles.emptyCopy, { color: palette.mutedText }]}>
              Loading downloads...
            </Text>
          </View>
          )
        : downloads.length === 0
        ? (
          <View style={styles.empty}>
            <DownloadIcon width={30} height={30} color={palette.mutedText} />
            <Text style={[styles.emptyTitle, { color: palette.text }]}>No downloads yet</Text>
            <Text style={[styles.emptyCopy, { color: palette.mutedText }]}>
              Files downloaded from websites will appear here.
            </Text>
          </View>
          )
        : (
          <FlatList
            contentContainerStyle={styles.list}
            data={sortedDownloads}
            keyExtractor={(download) => download.id}
            renderItem={({ item: download }) => (
              <View style={[styles.row, { borderBottomColor: palette.border }]}>
                <Pressable
                  accessibilityLabel={`Open ${download.name}`}
                  accessibilityRole='button'
                  disabled={download.status !== 'complete'}
                  style={({ pressed }) => [
                    styles.rowBody,
                    download.status !== 'complete' ? styles.rowDisabled : null,
                    pressed ? styles.pressed : null
                  ]}
                  onPress={() => onOpen(download.id)}
                >
                  <View style={[styles.fileIcon, { backgroundColor: palette.surface }]}>
                    <DownloadIcon width={18} height={18} color={palette.mutedText} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
                      {download.name}
                    </Text>
                    <Text style={[styles.rowMeta, { color: palette.mutedText }]} numberOfLines={1}>
                      {formatDownloadMeta(download)}
                    </Text>
                    <DownloadProgress download={download} color={palette.accent} trackColor={palette.border} />
                    {getDownloadFailureMessage(download) && (
                      <Text style={styles.rowError} numberOfLines={2}>
                        {getDownloadFailureMessage(download)}
                      </Text>
                    )}
                  </View>
                </Pressable>
                {['pending', 'running'].includes(download.status) &&
                  download.id.startsWith('r:') &&
                  Platform.OS === 'android' && (
                  <Pressable
                    accessibilityLabel={`Pause ${download.name}`}
                    accessibilityRole='button'
                    accessibilityState={{ disabled: pausingDownloadId === download.id }}
                    disabled={Boolean(pausingDownloadId)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.downloadAction, pressed ? styles.pressed : null]}
                    onPress={async () => {
                      if (pausingDownloadId) return
                      setPausingDownloadId(download.id)
                      try {
                        await onPause(download)
                      } finally {
                        setPausingDownloadId(null)
                      }
                    }}
                  >
                    {pausingDownloadId === download.id
                      ? <ActivityIndicator size='small' color={palette.accent} />
                      : <PauseIcon width={22} height={22} color={palette.accent} />}
                  </Pressable>
                )}
                {['failed', 'paused'].includes(download.status) && download.sourceUrl && (
                  <Pressable
                    accessibilityLabel={`${getDownloadRetryLabel(download)} ${download.name}`}
                    accessibilityRole='button'
                    accessibilityState={{ disabled: retryingDownloadId === download.id }}
                    disabled={retryingDownloadId === download.id}
                    hitSlop={8}
                    style={({ pressed }) => [styles.downloadAction, pressed ? styles.pressed : null]}
                    onPress={async () => {
                      if (retryingDownloadId) return
                      setRetryingDownloadId(download.id)
                      try {
                        await onRetry(download)
                      } finally {
                        setRetryingDownloadId(null)
                      }
                    }}
                  >
                    {retryingDownloadId === download.id
                      ? <ActivityIndicator size='small' color={palette.accent} />
                      : getDownloadRetryLabel(download) === 'Resume'
                        ? <PlayIcon width={22} height={22} color={palette.accent} />
                        : <ReloadIcon width={20} height={20} color={palette.accent} />}
                  </Pressable>
                )}
                <Pressable
                  accessibilityLabel={`Remove ${download.name}`}
                  accessibilityRole='button'
                  hitSlop={8}
                  style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
                  onPress={() => {
                    Alert.alert(
                      'Remove download?',
                      `Delete ${download.name} from this device?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => onRemove(download.id)
                        }
                      ]
                    )
                  }}
                >
                  <TrashIcon width={19} height={19} color='#a7354a' />
                </Pressable>
              </View>
            )}
          />
          )}

      <Modal
        animationType='fade'
        transparent
        visible={isSortOpen}
        onRequestClose={() => setIsSortOpen(false)}
      >
        <Pressable
          accessibilityLabel='Close sort options'
          accessibilityRole='button'
          style={styles.modalBackdrop}
          onPress={() => setIsSortOpen(false)}
        >
          <View
            style={[
              styles.sortSheet,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border
              }
            ]}
          >
            <Text style={[styles.sortTitle, { color: palette.text }]}>Sort by</Text>
            {DOWNLOAD_SORT_OPTIONS.map((option) => {
              const isSelected = option.id === sort
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole='radio'
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    styles.sortOption,
                    isSelected ? { backgroundColor: palette.selectedBackground } : null,
                    pressed ? styles.pressed : null
                  ]}
                  onPress={() => {
                    setSort(option.id)
                    setIsSortOpen(false)
                  }}
                >
                  <Text style={[styles.sortOptionText, { color: palette.text }]}>
                    {option.label}
                  </Text>
                  {isSelected && (
                    <CheckIcon width={20} height={20} color={palette.accent} />
                  )}
                </Pressable>
              )
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

function DownloadProgress ({
  color,
  download,
  trackColor
}: {
  color: string
  download: BrowserDownload
  trackColor: string
}) {
  const totalBytes = download.totalBytes || download.size
  const targetProgress = totalBytes > 0
    ? Math.min(1, Math.max(0, (download.downloadedBytes || 0) / totalBytes))
    : 0
  const progress = useRef(new Animated.Value(targetProgress)).current

  useEffect(() => {
    Animated.timing(progress, {
      duration: 300,
      toValue: targetProgress,
      useNativeDriver: false
    }).start()
  }, [progress, targetProgress])

  if (!['pending', 'running', 'paused'].includes(download.status) || totalBytes < 1) return null

  return (
    <View style={[styles.progressTrack, { backgroundColor: trackColor }]}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            backgroundColor: color,
            width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
          }
        ]}
      />
    </View>
  )
}

function formatDownloadMeta (download: BrowserDownload) {
  const status = download.status === 'paused'
    ? formatPausedStatus(download.reason)
    : download.status.charAt(0).toUpperCase() + download.status.slice(1)
  const totalBytes = download.totalBytes || download.size
  const downloadedBytes = download.downloadedBytes || 0
  const progress = totalBytes > 0 && ['pending', 'running', 'paused'].includes(download.status)
    ? `${Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))}%`
    : null
  if (download.size < 1 && totalBytes < 1) return progress ? `${status} · ${progress}` : status

  const units = ['B', 'KB', 'MB', 'GB']
  const displaySize = totalBytes || download.size
  const unitIndex = Math.min(Math.floor(Math.log(displaySize) / Math.log(1024)), units.length - 1)
  const size = displaySize / Math.pow(1024, unitIndex)
  return `${status}${progress ? ` · ${progress}` : ''} · ${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function getDownloadFailureMessage (download: BrowserDownload) {
  if (download.status === 'paused') return getPausedReason(download.reason)
  if (download.status !== 'failed') return null
  const nativeReason = getFailureReason(download.reason)
  if (nativeReason) return nativeReason
  return getProxiedHyperUrl(download.sourceUrl)
    ? 'Peer went offline, please try again.'
    : 'Download failed. Please try again.'
}

function getDownloadRetryLabel (download: BrowserDownload) {
  if (
    download.id.startsWith('r:') &&
    (
      download.status === 'paused' ||
      (
        download.status === 'failed' &&
        (download.downloadedBytes || 0) > 0 &&
        ['network-error', 'incomplete-response'].includes(download.reason || '')
      )
    )
  ) return 'Resume'
  return 'Retry'
}

function formatPausedStatus (reason?: string) {
  if (reason === 'user-paused') return 'Paused by you'
  if (reason === 'interrupted') return 'Paused after app closed'
  return 'Paused by Android'
}

function getPausedReason (reason?: string) {
  if (reason === 'user-paused' || reason === 'interrupted') return null
  if (reason === 'waiting-for-network') return 'Waiting for a network connection. Android will resume automatically.'
  if (reason === 'queued-for-wifi') return 'Waiting for Wi-Fi. Android will resume automatically.'
  if (reason === 'waiting-to-retry') return 'A network request failed. Android is waiting to retry.'
  return 'Android paused this download and should resume it automatically.'
}

function getFailureReason (reason?: string) {
  if (reason === 'insufficient-space') return 'There is not enough storage space for this download.'
  if (reason === 'file-exists') return 'A file already exists at the download destination.'
  if (reason === 'cannot-resume') return 'Android could not resume this download. Please retry it.'
  if (reason === 'device-unavailable') return 'The download storage is unavailable.'
  if (reason === 'too-many-redirects') return 'The download failed after too many redirects.'
  if (reason === 'unhandled-http') return 'The server returned an unsupported response.'
  if (reason === 'http-data-error') return 'The connection ended while Android was receiving this file.'
  if (reason === 'file-error') return 'Android could not write this file.'
  if (reason === 'network-error') return 'The connection ended. Resume or retry this download.'
  if (reason === 'http-error') return 'The server returned an error response.'
  if (reason === 'incomplete-response') return 'The server stopped before the file was complete.'
  return null
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 12
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    marginLeft: 4
  },
  iconButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  downloadAction: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  sortButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 8
  },
  sortButtonText: {
    fontSize: 14,
    fontWeight: '800'
  },
  errorBanner: {
    backgroundColor: '#fff1f3',
    borderBottomColor: '#efb8c2',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 11
  },
  errorText: {
    color: '#8f2940',
    fontSize: 13,
    lineHeight: 18
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 32
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 13
  },
  emptyCopy: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center'
  },
  list: {
    paddingHorizontal: 18
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 72
  },
  rowBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    minHeight: 72
  },
  rowDisabled: {
    opacity: 0.55
  },
  fileIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    marginRight: 12,
    width: 34
  },
  rowCopy: {
    flex: 1
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700'
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 4
  },
  progressTrack: {
    borderRadius: 2,
    height: 3,
    marginTop: 7,
    overflow: 'hidden',
    width: '100%'
  },
  progressFill: {
    borderRadius: 2,
    height: '100%'
  },
  rowError: {
    color: '#a7354a',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3
  },
  pressed: {
    opacity: 0.6
  },
  modalBackdrop: {
    backgroundColor: 'rgba(9, 15, 27, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16
  },
  sortSheet: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 10
  },
  sortTitle: {
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  sortOption: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: 14
  },
  sortOptionText: {
    fontSize: 15,
    fontWeight: '600'
  }
})
