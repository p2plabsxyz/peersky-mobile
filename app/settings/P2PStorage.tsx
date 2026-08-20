import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import {
  RPC_HYPER_STORAGE_CLEAR_CACHE,
  RPC_HYPER_STORAGE_DELETE_APP,
  RPC_HYPER_STORAGE_LIST
} from '../../backend/rpc/commands.mjs'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { SettingsSection, useSettingsDarkMode } from './SettingsUI'

type P2pAppData = {
  id: string
  title: string
  url: string
  fileCount: number
  byteLength: number
  exists?: boolean
  truncated?: boolean
}

type P2pStorageResponse = {
  ok: boolean
  error?: string
  items?: P2pAppData[]
  page?: number
  total?: number
  totalPages?: number
  clearedCores?: number
}

type P2PStorageProps = {
  onCallRpc: (command: number, data?: object) => Promise<P2pStorageResponse>
}

const PAGE_SIZE = 5

export function P2PStorage ({ onCallRpc }: P2PStorageProps) {
  const isDark = useSettingsDarkMode()
  const requestSequence = useRef(0)
  const activeActionRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const [items, setItems] = useState<P2pAppData[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadPage(page)
    return () => { requestSequence.current += 1 }
  }, [page])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function loadPage (nextPage: number) {
    const sequence = ++requestSequence.current
    setIsLoading(true)
    setError(null)

    try {
      const response = await onCallRpc(RPC_HYPER_STORAGE_LIST, {
        page: nextPage,
        pageSize: PAGE_SIZE
      })
      if (sequence !== requestSequence.current) return
      if (!response.ok) throw new Error(response.error || 'Unable to read P2P data.')

      setItems(response.items || [])
      setPage(response.page || nextPage)
      setTotalPages(Math.max(1, response.totalPages || 1))
    } catch (loadError) {
      if (sequence !== requestSequence.current) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false)
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

    try {
      const response = await onCallRpc(RPC_HYPER_STORAGE_DELETE_APP, { appId: item.id })
      if (!response.ok) throw new Error(response.error || `Unable to delete ${item.title} data.`)
      await loadPage(page)
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
      'This removes Hyper data downloaded from other peers. Locally owned P2PMD and Hyperdrive files are kept.',
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

    try {
      const response = await onCallRpc(RPC_HYPER_STORAGE_CLEAR_CACHE)
      if (!response.ok) throw new Error(response.error || 'Unable to clear downloaded P2P cache.')
      if (mountedRef.current) {
        Alert.alert('P2P cache cleared', `${response.clearedCores || 0} cached data stores removed.`)
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
                {item.exists && (
                  <Text numberOfLines={1} style={[styles.url, isDark ? darkStyles.secondaryText : null]}>
                    {item.url}
                  </Text>
                )}
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

        {totalPages > 1 && (
          <View style={[styles.pagination, isDark ? darkStyles.divider : null]}>
            <PageButton title='Previous' disabled={page <= 1 || isLoading} onPress={() => setPage((value) => value - 1)} />
            <Text style={[styles.pageText, isDark ? darkStyles.secondaryText : null]}>
              {page} of {totalPages}
            </Text>
            <PageButton title='Next' disabled={page >= totalPages || isLoading} onPress={() => setPage((value) => value + 1)} />
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
            <Text style={styles.clearText}>{activeAction === 'cache' ? 'Clearing...' : 'Clear'}</Text>
          </Pressable>
        </View>
      </SettingsSection>

      {error && <Text accessibilityRole='alert' style={styles.error}>{error}</Text>}
    </>
  )
}

function PageButton ({ title, disabled, onPress }: { title: string, disabled: boolean, onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.pageButton, disabled ? styles.disabled : null]}
    >
      <Text style={styles.pageButtonText}>{title}</Text>
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
  url: {
    color: '#687086',
    fontFamily: 'monospace',
    fontSize: 10
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
  }
})
