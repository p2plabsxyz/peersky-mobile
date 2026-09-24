import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native'
import {
  RPC_HYPER_OFFLINE_LIST,
  RPC_HYPER_OFFLINE_PAUSE,
  RPC_HYPER_OFFLINE_REMOVE,
  RPC_HYPER_OFFLINE_RESUME,
  RPC_HYPER_STORAGE_CLEAR_CACHE,
  RPC_HYPER_STORAGE_CLEAR_ALL,
  RPC_HYPER_STORAGE_DELETE_APP,
  RPC_HYPER_STORAGE_LIST
} from '../../backend/rpc/commands.mjs'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import CopyIcon from '../../assets/icons/bootstrap/copy.svg'
import { clearHyperdriveRecents } from '../hyperdrive/recents-store'
import { SettingsSection, useSettingsDarkMode } from './SettingsUI'

type P2pAppData = {
  id: string
  title: string
  url: string
  fileCount: number
  byteLength: number
  exists?: boolean
  truncated?: boolean
  drives?: Array<{
    id: string
    title: string
    url: string
    fileCount: number
    byteLength: number
    truncated?: boolean
    warning?: string
  }>
}

type P2pStorageResponse = {
  ok: boolean
  error?: string
  warning?: string
  items?: P2pAppData[]
  page?: number
  total?: number
  totalPages?: number
  clearedCores?: number
  cleared?: boolean
  archive?: {
    items: HyperArchiveItem[]
    page: number
    total: number
    totalPages: number
  }
}

type HyperArchiveSource = 'all' | 'published' | 'fetched'

type HyperArchiveItem = {
  url: string
  driveUrl: string
  name: string
  source: Exclude<HyperArchiveSource, 'all'>
  appId?: string
  updatedAt: number
}

type HyperOfflineItem = {
  driveKey: string
  path: string
  wantedAt: number
  status: 'available' | 'downloading' | 'error' | 'paused' | 'waiting-for-wifi'
  byteLength?: number
  sizeTruncated?: boolean
  sizeUnavailable?: boolean
  error?: string
}

type HyperOfflineResponse = {
  ok: boolean
  error?: string
  warning?: string
  item?: HyperOfflineItem
  items?: HyperOfflineItem[]
}

type P2PStorageProps = {
  downloadOnlyOnWifi: boolean
  offlineNetworkAllowed: boolean
  onCallRpc: (command: number, data?: object) => Promise<P2pStorageResponse>
  onDownloadOnlyOnWifiChange: (enabled: boolean) => void
  onOpenItem: (item: { name: string, source: 'fetched' | 'published', url: string }) => void
}

const PAGE_SIZE = 5

export function P2PStorage ({ downloadOnlyOnWifi, offlineNetworkAllowed, onCallRpc, onDownloadOnlyOnWifiChange, onOpenItem }: P2PStorageProps) {
  const isDark = useSettingsDarkMode()
  const requestSequence = useRef(0)
  const offlineRequestSequence = useRef(0)
  const activeActionRef = useRef<string | null>(null)
  const appDataLoadedRef = useRef(false)
  const mountedRef = useRef(true)
  const [items, setItems] = useState<P2pAppData[]>([])
  const [archiveItems, setArchiveItems] = useState<HyperArchiveItem[]>([])
  const [archivePage, setArchivePage] = useState(1)
  const [archiveTotalPages, setArchiveTotalPages] = useState(1)
  const [archiveSource, setArchiveSource] = useState<HyperArchiveSource>('all')
  const [offlineItems, setOfflineItems] = useState<HyperOfflineItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isOfflineLoading, setIsOfflineLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [offlineError, setOfflineError] = useState<string | null>(null)

  useEffect(() => {
    void loadPage(archivePage, archiveSource)
    return () => { requestSequence.current += 1 }
  }, [archivePage, archiveSource])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    void loadOfflineItems()
    return () => { offlineRequestSequence.current += 1 }
  }, [])

  useEffect(() => {
    if (!offlineItems.some((item) => (
      item.status === 'downloading' ||
      (offlineNetworkAllowed && item.status === 'waiting-for-wifi')
    ))) return
    const timer = setTimeout(() => void loadOfflineItems(false), 2000)
    return () => clearTimeout(timer)
  }, [offlineItems, offlineNetworkAllowed])

  async function loadPage (
    nextPage: number,
    nextSource = archiveSource,
    includeAppData = !appDataLoadedRef.current
  ) {
    const sequence = ++requestSequence.current
    setIsLoading(true)
    setError(null)

    try {
      const response = await onCallRpc(RPC_HYPER_STORAGE_LIST, {
        page: 1,
        pageSize: 10,
        archivePage: nextPage,
        archivePageSize: PAGE_SIZE,
        archiveSource: nextSource,
        includeAppData
      })
      if (sequence !== requestSequence.current) return
      if (!response.ok) throw new Error(response.error || 'Unable to read P2P data.')

      if (response.items) {
        setItems(response.items)
        appDataLoadedRef.current = true
      }
      setArchiveItems(response.archive?.items || [])
      setArchivePage(response.archive?.page || nextPage)
      setArchiveTotalPages(Math.max(1, response.archive?.totalPages || 1))
      setNotice(response.warning || null)
    } catch (loadError) {
      if (sequence !== requestSequence.current) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false)
    }
  }

  async function loadOfflineItems (showLoading = true) {
    const sequence = ++offlineRequestSequence.current
    if (showLoading) setIsOfflineLoading(true)
    setOfflineError(null)

    try {
      const response = await onCallRpc(RPC_HYPER_OFFLINE_LIST) as HyperOfflineResponse
      if (sequence !== offlineRequestSequence.current) return
      if (!response.ok) throw new Error(response.error || 'Unable to read offline folders.')
      setOfflineItems(response.items || [])
    } catch (loadError) {
      if (sequence !== offlineRequestSequence.current) return
      setOfflineError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (sequence === offlineRequestSequence.current) setIsOfflineLoading(false)
    }
  }

  function confirmRemoveOffline (item: HyperOfflineItem) {
    Alert.alert(
      'Remove offline copy?',
      `${formatOfflineName(item)} will remain available from peers, but its downloaded files will be removed from this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void runOfflineAction(item, RPC_HYPER_OFFLINE_REMOVE)
        }
      ]
    )
  }

  async function runOfflineAction (item: HyperOfflineItem, command: number) {
    if (activeActionRef.current) return
    const actionId = `offline:${item.driveKey}:${item.path}`
    activeActionRef.current = actionId
    setActiveAction(actionId)
    setOfflineError(null)
    setNotice(null)

    try {
      const payload = command === RPC_HYPER_OFFLINE_RESUME
        ? { driveKey: item.driveKey, path: item.path, wait: false }
        : { driveKey: item.driveKey, path: item.path }
      const response = await onCallRpc(command, payload) as HyperOfflineResponse
      if (!response.ok) throw new Error(response.error || 'Unable to update the offline folder.')
      if (mountedRef.current) {
        setNotice(response.item?.status === 'waiting-for-wifi'
          ? 'Offline download is waiting for Wi-Fi.'
          : response.warning || null)
        await loadOfflineItems(false)
      }
    } catch (actionError) {
      if (mountedRef.current) {
        setOfflineError(actionError instanceof Error ? actionError.message : String(actionError))
      }
    } finally {
      activeActionRef.current = null
      if (mountedRef.current) setActiveAction(null)
    }
  }

  function confirmDeleteApp (item: P2pAppData) {
    Alert.alert(
      `Delete ${item.title} P2P data?`,
      'This permanently removes locally owned files for this app. Published copies may remain available from other peers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void deleteApp(item)
        }
      ]
    )
  }

  async function deleteApp (item: P2pAppData) {
    if (activeActionRef.current) return
    activeActionRef.current = item.id
    setActiveAction(item.id)
    setError(null)
    setNotice(null)

    try {
      const response = await onCallRpc(RPC_HYPER_STORAGE_DELETE_APP, { appId: item.id })
      if (!response.ok) throw new Error(response.error || `Unable to delete ${item.title} data.`)
      const recentWarning = item.id === 'hyperdrive' && !clearHyperdriveRecents('uploaded')
        ? 'App data was deleted, but Hyperdrive Recent could not be updated.'
        : null
      if (mountedRef.current) {
        setNotice(joinNotices(response.warning, recentWarning))
        await refreshArchive()
      }
    } catch (deleteError) {
      if (mountedRef.current) {
        setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
      }
    } finally {
      activeActionRef.current = null
      if (mountedRef.current) setActiveAction(null)
    }
  }

  function confirmClearCache () {
    Alert.alert(
      'Clear downloaded P2P cache?',
      'This removes Hyper data downloaded from other peers. Locally owned P2PMD and Hyperdrive files, PeerChat rooms, and message history are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => void clearCache() }
      ]
    )
  }

  async function clearCache () {
    if (activeActionRef.current) return
    activeActionRef.current = 'cache'
    setActiveAction('cache')
    setError(null)
    setNotice(null)

    try {
      const response = await onCallRpc(RPC_HYPER_STORAGE_CLEAR_CACHE)
      if (!response.ok) throw new Error(response.error || 'Unable to clear downloaded P2P cache.')
      const recentWarning = !clearHyperdriveRecents('fetched')
        ? 'Downloaded data was cleared, but Hyperdrive Recent could not be updated.'
        : null
      if (mountedRef.current) {
        setNotice(joinNotices(response.warning, recentWarning))
        Alert.alert('P2P cache cleared', `${response.clearedCores || 0} cached data stores removed.`)
        await refreshArchive()
      }
    } catch (clearError) {
      if (mountedRef.current) {
        setError(clearError instanceof Error ? clearError.message : String(clearError))
      }
    } finally {
      activeActionRef.current = null
      if (mountedRef.current) setActiveAction(null)
    }
  }

  function confirmClearAllData () {
    Alert.alert(
      'Clear all P2P data?',
      'This permanently removes locally owned P2PMD and Hyperdrive files, PeerChat rooms and message history, downloaded Hyper data, and signing keys from this device. You will permanently lose the ability to update previously shared Hyper URLs, leaving them frozen unless another peer retains their signing keys.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => void clearAllData() }
      ]
    )
  }

  async function clearAllData () {
    if (activeActionRef.current) return
    activeActionRef.current = 'all'
    setActiveAction('all')
    setError(null)
    setNotice(null)

    try {
      const response = await onCallRpc(RPC_HYPER_STORAGE_CLEAR_ALL)
      if (!response.ok || !response.cleared) throw new Error(response.error || 'Unable to clear P2P data.')
      const recentWarning = !clearHyperdriveRecents()
        ? 'P2P data was cleared, but Hyperdrive Recent could not be updated.'
        : null
      if (mountedRef.current) {
        setNotice(joinNotices(response.warning, recentWarning))
        Alert.alert('P2P data cleared', 'All local Hyper and PeerChat data was removed from this device.')
        await refreshArchive()
      }
    } catch (clearError) {
      if (mountedRef.current) {
        setError(clearError instanceof Error ? clearError.message : String(clearError))
      }
    } finally {
      activeActionRef.current = null
      if (mountedRef.current) setActiveAction(null)
    }
  }

  async function refreshArchive () {
    if (!mountedRef.current) return
    appDataLoadedRef.current = false
    if (archivePage === 1) {
      await loadPage(1, archiveSource, true)
    } else {
      setArchivePage(1)
    }
  }

  function changeArchiveSource (source: HyperArchiveSource) {
    setNotice(null)
    setArchivePage(1)
    setArchiveSource(source)
  }

  function copyArchiveUrl (item: HyperArchiveItem) {
    try {
      Clipboard.setString(item.url)
      setError(null)
      setNotice('Hyper URL copied.')
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError))
    }
  }

  return (
    <>
      <SettingsSection title='App data'>
        {isLoading && items.length === 0
          ? <ActivityIndicator style={styles.loading} />
          : items.map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.appRow,
                index > 0 ? styles.divider : null,
                index > 0 && isDark ? darkStyles.divider : null
              ]}
            >
              <View style={styles.copy}>
                <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>{item.title}</Text>
                <Text style={[styles.description, isDark ? darkStyles.secondaryText : null]}>
                  {item.exists
                    ? `${formatFileCount(item.fileCount, item.truncated)} - ${formatBytes(item.byteLength)} file content`
                    : 'No local data'}
                </Text>
                {item.exists && item.url && (
                  <Text numberOfLines={1} style={[styles.url, isDark ? darkStyles.secondaryText : null]}>
                    {item.url}
                  </Text>
                )}
                {item.drives?.map((drive) => (
                  <View key={drive.id} style={styles.driveRow}>
                    <Text style={[styles.driveTitle, isDark ? darkStyles.primaryText : null]}>
                      {drive.title}
                    </Text>
                    <View style={styles.driveDetails}>
                      <Text style={[styles.driveSize, isDark ? darkStyles.secondaryText : null]}>
                        {formatFileCount(drive.fileCount, drive.truncated)} - {formatBytes(drive.byteLength)}
                      </Text>
                      <Text numberOfLines={1} style={[styles.driveUrl, isDark ? darkStyles.secondaryText : null]}>
                        {drive.url}
                      </Text>
                      {drive.warning && (
                        <Text style={[styles.driveWarning, isDark ? darkStyles.warningText : null]}>
                          {drive.warning}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
              <Pressable
                accessibilityLabel={`Delete ${item.title} P2P data`}
                accessibilityRole='button'
                accessibilityState={{ disabled: activeAction !== null || !item.exists }}
                disabled={activeAction !== null || !item.exists}
                onPress={() => confirmDeleteApp(item)}
                style={({ pressed }) => [
                  styles.deleteButton,
                  pressed ? styles.buttonPressed : null,
                  activeAction !== null || !item.exists ? styles.disabled : null
                ]}
              >
                <Text style={styles.deleteText}>{activeAction === item.id ? 'Deleting...' : 'Delete'}</Text>
              </Pressable>
            </View>
          ))}

      </SettingsSection>

      <SettingsSection title='Offline Hyper folders'>
        <View style={[styles.offlinePreference, isDark ? darkStyles.divider : null]}>
          <View style={styles.copy}>
            <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>Download only on Wi-Fi</Text>
            <Text style={[styles.description, isDark ? darkStyles.secondaryText : null]}>
              Wait for Wi-Fi before saving Hyper folders for offline use.
            </Text>
          </View>
          <Switch
            accessibilityLabel='Download offline Hyper folders only on Wi-Fi'
            value={downloadOnlyOnWifi}
            onValueChange={onDownloadOnlyOnWifiChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={downloadOnlyOnWifi ? '#1f6fd1' : '#ffffff'}
          />
        </View>
        {isOfflineLoading && offlineItems.length === 0
          ? <ActivityIndicator style={styles.loading} />
          : offlineItems.length === 0
            ? <Text style={[styles.empty, isDark ? darkStyles.secondaryText : null]}>No folders are kept offline.</Text>
            : offlineItems.map((item, index) => {
              const actionId = `offline:${item.driveKey}:${item.path}`
              const isActive = activeAction === actionId
              const canResume = item.status === 'paused' || item.status === 'waiting-for-wifi' || item.status === 'error'

              return (
                <View
                  key={`${item.driveKey}:${item.path}`}
                  style={[
                    styles.offlineRow,
                    index > 0 ? styles.divider : null,
                    index > 0 && isDark ? darkStyles.divider : null
                  ]}
                >
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={[styles.title, isDark ? darkStyles.primaryText : null]}>
                      {formatOfflineName(item)}
                    </Text>
                    <Text numberOfLines={1} style={[styles.url, isDark ? darkStyles.secondaryText : null]}>
                      {shortOfflineUrl(item)}
                    </Text>
                    <Text style={[styles.description, isDark ? darkStyles.secondaryText : null]}>
                      {formatOfflineStatus(item)}
                    </Text>
                  </View>
                  <View style={styles.offlineActions}>
                    {item.status === 'downloading' && (
                      <Pressable
                        accessibilityLabel={`Pause ${formatOfflineName(item)} offline download`}
                        accessibilityRole='button'
                        disabled={activeAction !== null}
                        onPress={() => void runOfflineAction(item, RPC_HYPER_OFFLINE_PAUSE)}
                        style={({ pressed }) => [styles.offlineAction, pressed ? styles.buttonPressed : null, activeAction !== null ? styles.disabled : null]}
                      >
                        <Text style={[styles.clearText, isDark ? darkStyles.actionText : null]}>{isActive ? 'Pausing...' : 'Pause'}</Text>
                      </Pressable>
                    )}
                    {canResume && (
                      <Pressable
                        accessibilityLabel={`Resume ${formatOfflineName(item)} offline download`}
                        accessibilityRole='button'
                        disabled={activeAction !== null}
                        onPress={() => void runOfflineAction(item, RPC_HYPER_OFFLINE_RESUME)}
                        style={({ pressed }) => [styles.offlineAction, pressed ? styles.buttonPressed : null, activeAction !== null ? styles.disabled : null]}
                      >
                        <Text style={[styles.clearText, isDark ? darkStyles.actionText : null]}>{isActive ? 'Starting...' : 'Resume'}</Text>
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityLabel={`Remove ${formatOfflineName(item)} offline copy`}
                      accessibilityRole='button'
                      disabled={activeAction !== null}
                      onPress={() => confirmRemoveOffline(item)}
                      style={({ pressed }) => [styles.offlineAction, pressed ? styles.buttonPressed : null, activeAction !== null ? styles.disabled : null]}
                    >
                      <Text style={styles.deleteText}>{isActive ? 'Working...' : 'Remove'}</Text>
                    </Pressable>
                  </View>
                </View>
              )
            })}
      </SettingsSection>

      {offlineError && <Text accessibilityRole='alert' style={styles.error}>{offlineError}</Text>}

      {notice && <Text accessibilityRole='alert' style={styles.notice}>{notice}</Text>}

      <SettingsSection title='Hyper archive'>
        <View style={[styles.filters, isDark ? darkStyles.divider : null]}>
          {(['all', 'published', 'fetched'] as HyperArchiveSource[]).map((source) => (
            <Pressable
              key={source}
              accessibilityRole='button'
              accessibilityState={{ selected: archiveSource === source }}
              onPress={() => changeArchiveSource(source)}
              style={[
                styles.filter,
                archiveSource === source ? styles.filterSelected : null,
                archiveSource === source && isDark ? darkStyles.filterSelected : null
              ]}
            >
              <Text style={[
                styles.filterText,
                isDark ? darkStyles.secondaryText : null,
                archiveSource === source ? styles.filterTextSelected : null,
                archiveSource === source && isDark ? darkStyles.filterTextSelected : null
              ]}>
                {source[0].toUpperCase() + source.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {isLoading && archiveItems.length === 0
          ? <ActivityIndicator style={styles.loading} />
          : archiveItems.length === 0
            ? <Text style={[styles.empty, isDark ? darkStyles.secondaryText : null]}>No Hyper activity yet.</Text>
            : archiveItems.map((item, index) => (
              <View
                key={`${item.source}:${item.url}`}
                style={[
                  styles.archiveRow,
                  index > 0 ? styles.divider : null,
                  index > 0 && isDark ? darkStyles.divider : null
                ]}
              >
                <Pressable
                  accessibilityLabel={`Open ${item.name}`}
                  accessibilityRole='button'
                  onPress={() => onOpenItem(item)}
                  style={({ pressed }) => [styles.copy, pressed ? styles.buttonPressed : null]}
                >
                  <View style={styles.archiveTitleRow}>
                    <Text numberOfLines={1} style={[styles.title, styles.archiveTitle, isDark ? darkStyles.primaryText : null]}>
                      {item.name}
                    </Text>
                    <Text style={[
                      styles.source,
                      item.source === 'published' ? styles.published : styles.fetched
                    ]}>
                      {item.source}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={[styles.url, isDark ? darkStyles.secondaryText : null]}>{item.url}</Text>
                  <Text style={[styles.timestamp, isDark ? darkStyles.secondaryText : null]}>{formatTimestamp(item.updatedAt)}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Copy ${item.name} Hyper URL`}
                  accessibilityRole='button'
                  hitSlop={6}
                  onPress={() => copyArchiveUrl(item)}
                  style={({ pressed }) => [styles.archiveAction, pressed ? styles.buttonPressed : null]}
                >
                  <CopyIcon width={18} height={18} color={isDark ? BROWSER_PALETTES.dark.selectedControl : BROWSER_PALETTES.light.selectedControl} />
                </Pressable>
              </View>
            ))}

        {archiveTotalPages > 1 && (
          <View style={[styles.pagination, isDark ? darkStyles.divider : null]}>
            <PageButton isDark={isDark} title='Previous' disabled={archivePage <= 1 || isLoading} onPress={() => setArchivePage((value) => value - 1)} />
            <Text style={[styles.pageText, isDark ? darkStyles.secondaryText : null]}>
              {archivePage} of {archiveTotalPages}
            </Text>
            <PageButton isDark={isDark} title='Next' disabled={archivePage >= archiveTotalPages || isLoading} onPress={() => setArchivePage((value) => value + 1)} />
          </View>
        )}
      </SettingsSection>

      <SettingsSection title='Downloaded cache'>
        <View style={styles.cacheRow}>
          <View style={styles.copy}>
            <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>Clear P2P cache</Text>
            <Text style={[styles.description, isDark ? darkStyles.secondaryText : null]}>
              Remove downloaded Hyper data while keeping files owned by your apps.
            </Text>
          </View>
          <Pressable
            accessibilityRole='button'
            accessibilityState={{ disabled: activeAction !== null }}
            disabled={activeAction !== null}
            onPress={confirmClearCache}
            style={({ pressed }) => [
              styles.clearButton,
              pressed ? styles.buttonPressed : null,
              activeAction !== null ? styles.disabled : null
            ]}
          >
            <Text style={[styles.clearText, isDark ? darkStyles.actionText : null]}>{activeAction === 'cache' ? 'Clearing...' : 'Clear'}</Text>
          </Pressable>
        </View>
      </SettingsSection>

      <SettingsSection title='All P2P data'>
        <View style={styles.cacheRow}>
          <View style={styles.copy}>
            <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>Clear all P2P data</Text>
            <Text style={[styles.description, isDark ? darkStyles.secondaryText : null]}>
              Permanently remove owned app files and downloaded Hyper data from this device.
            </Text>
          </View>
          <Pressable
            accessibilityRole='button'
            accessibilityState={{ disabled: activeAction !== null }}
            disabled={activeAction !== null}
            onPress={confirmClearAllData}
            style={({ pressed }) => [
              styles.clearButton,
              pressed ? styles.buttonPressed : null,
              activeAction !== null ? styles.disabled : null
            ]}
          >
            <Text style={styles.deleteText}>{activeAction === 'all' ? 'Clearing...' : 'Clear all'}</Text>
          </Pressable>
        </View>
      </SettingsSection>

      {error && <Text accessibilityRole='alert' style={styles.error}>{error}</Text>}
    </>
  )
}

function PageButton ({
  title,
  disabled,
  isDark,
  onPress
}: {
  title: string
  disabled: boolean
  isDark: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.pageButton, disabled ? styles.disabled : null]}
    >
      <Text style={[styles.pageButtonText, isDark ? darkStyles.actionText : null]}>{title}</Text>
    </Pressable>
  )
}

function formatBytes (bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatFileCount (count: number, truncated?: boolean) {
  const value = `${count}${truncated ? '+' : ''}`
  return `${value} ${count === 1 ? 'file' : 'files'}`
}

function formatTimestamp (timestamp: number) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return ''
  return new Date(timestamp).toLocaleString()
}

function formatOfflineName (item: HyperOfflineItem) {
  if (item.path === '/') return 'Entire drive'
  const parts = item.path.split('/').filter(Boolean)
  const name = parts[parts.length - 1] || item.path
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

function shortOfflineUrl (item: HyperOfflineItem) {
  const key = item.driveKey.length > 16
    ? `${item.driveKey.slice(0, 8)}...${item.driveKey.slice(-6)}`
    : item.driveKey
  return `hyper://${key}${item.path}`
}

function formatOfflineStatus (item: HyperOfflineItem) {
  if (item.status === 'available') {
    if (item.sizeUnavailable) return 'Available offline - size unavailable'
    const suffix = item.sizeTruncated ? '+' : ''
    return `Available offline - ${formatBytes(item.byteLength || 0)}${suffix}`
  }
  if (item.status === 'downloading') return 'Downloading for offline use'
  if (item.status === 'waiting-for-wifi') return 'Waiting for Wi-Fi'
  if (item.status === 'error') return item.error || 'Download failed'
  return 'Paused'
}

function joinNotices (...notices: Array<string | null | undefined>) {
  return notices.filter(Boolean).join(' ') || null
}

const styles = StyleSheet.create({
  appRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 86,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  cacheRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 78,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  offlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 82,
    paddingHorizontal: 18,
    paddingVertical: 11
  },
  offlinePreference: {
    alignItems: 'center',
    borderBottomColor: '#e6ecf5',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14
  },
  offlineActions: {
    alignItems: 'flex-end',
    gap: 2
  },
  offlineAction: {
    paddingHorizontal: 4,
    paddingVertical: 5
  },
  archiveRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 82,
    paddingHorizontal: 18,
    paddingVertical: 11
  },
  archiveTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7
  },
  archiveTitle: {
    flexShrink: 1
  },
  archiveAction: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  copy: {
    flex: 1,
    gap: 3
  },
  title: {
    color: '#1f2a44',
    fontSize: 14,
    fontWeight: '700'
  },
  description: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17
  },
  driveRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    marginTop: 4
  },
  driveTitle: {
    fontSize: 11,
    fontWeight: '700',
    width: 44
  },
  driveDetails: {
    flex: 1
  },
  driveSize: {
    color: '#687086',
    fontSize: 10
  },
  driveUrl: {
    color: '#687086',
    fontFamily: 'monospace',
    fontSize: 9
  },
  driveWarning: {
    color: '#a97400',
    fontSize: 10,
    marginTop: 2
  },
  url: {
    color: '#687086',
    fontFamily: 'monospace',
    fontSize: 10
  },
  timestamp: {
    color: '#687086',
    fontSize: 10
  },
  source: {
    borderRadius: 8,
    fontSize: 9,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    textTransform: 'uppercase'
  },
  published: {
    backgroundColor: '#dff6e9',
    color: '#1b7045'
  },
  fetched: {
    backgroundColor: '#e6f1ff',
    color: '#1f6fd1'
  },
  filters: {
    borderBottomColor: '#e1e7f0',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  filter: {
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  filterSelected: {
    backgroundColor: '#e6f1ff'
  },
  filterText: {
    color: '#687086',
    fontSize: 11,
    fontWeight: '700'
  },
  filterTextSelected: {
    color: '#1f6fd1'
  },
  empty: {
    color: '#687086',
    fontSize: 12,
    paddingHorizontal: 18,
    paddingVertical: 24,
    textAlign: 'center'
  },
  divider: {
    borderTopColor: '#e1e7f0',
    borderTopWidth: 1
  },
  loading: {
    marginVertical: 28
  },
  deleteButton: {
    paddingHorizontal: 4,
    paddingVertical: 10
  },
  deleteText: {
    color: '#bd3552',
    fontSize: 13,
    fontWeight: '700'
  },
  clearButton: {
    paddingHorizontal: 4,
    paddingVertical: 10
  },
  clearText: {
    color: '#1f6fd1',
    fontSize: 13,
    fontWeight: '700'
  },
  buttonPressed: {
    opacity: 0.65
  },
  disabled: {
    opacity: 0.45
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: '#e1e7f0',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10
  },
  pageButton: {
    paddingVertical: 6
  },
  pageButtonText: {
    color: '#1f6fd1',
    fontSize: 12,
    fontWeight: '700'
  },
  pageText: {
    color: '#687086',
    fontSize: 11
  },
  error: {
    color: '#bd3552',
    fontSize: 12,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  notice: {
    color: '#1b7045',
    fontSize: 12,
    paddingHorizontal: 20,
    paddingVertical: 12
  }
})

const darkStyles = StyleSheet.create({
  primaryText: {
    color: BROWSER_PALETTES.dark.text
  },
  secondaryText: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  divider: {
    borderTopColor: BROWSER_PALETTES.dark.border
  },
  filterSelected: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  filterTextSelected: {
    color: BROWSER_PALETTES.dark.text
  },
  actionText: {
    color: BROWSER_PALETTES.dark.selectedControl
  },
  warningText: {
    color: '#e0b030'
  }
})
