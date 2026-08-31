import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useMemo, useState } from 'react'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import DownloadIcon from '../../assets/icons/bootstrap/download.svg'
import ReloadIcon from '../../assets/icons/bootstrap/arrow-clockwise.svg'
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
  onRefresh,
  onRemove,
  onRetry
}: DownloadsScreenProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const [sort, setSort] = useState<DownloadSort>('newest')
  const [isSortOpen, setIsSortOpen] = useState(false)
  const [retryingDownloadId, setRetryingDownloadId] = useState<string | null>(null)
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
                    {getDownloadFailureMessage(download) && (
                      <Text style={styles.rowError} numberOfLines={2}>
                        {getDownloadFailureMessage(download)}
                      </Text>
                    )}
                  </View>
                </Pressable>
                {download.status === 'failed' && download.sourceUrl && (
                  <Pressable
                    accessibilityLabel={`Retry ${download.name}`}
                    accessibilityRole='button'
                    accessibilityState={{ disabled: retryingDownloadId === download.id }}
                    disabled={retryingDownloadId === download.id}
                    hitSlop={8}
                    style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
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
                      : <ReloadIcon width={19} height={19} color={palette.accent} />}
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

function formatDownloadMeta (download: BrowserDownload) {
  const status = download.status === 'paused'
    ? 'Paused - resumes automatically'
    : download.status.charAt(0).toUpperCase() + download.status.slice(1)
  if (download.size < 1) return status

  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(download.size) / Math.log(1024)), units.length - 1)
  const size = download.size / Math.pow(1024, unitIndex)
  return `${status} · ${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function getDownloadFailureMessage (download: BrowserDownload) {
  if (download.status !== 'failed') return null
  return getProxiedHyperUrl(download.sourceUrl)
    ? 'The peer may be offline. Please try again.'
    : 'Download failed. Please try again.'
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
