import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import {
  getContentBlockingStatus,
  updateContentBlockingLists
} from '../privacy/contentBlocking'
import {
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'

type ContentBlockingStatus = Awaited<ReturnType<typeof getContentBlockingStatus>>

type PrivacyProps = {
  contentBlockingEnabled: boolean
  youtubeAdBlockingEnabled: boolean
  persistenceError: string | null
  onContentBlockingEnabledChange: (enabled: boolean) => Promise<void>
  onFilterListsUpdated: () => void
  onYoutubeAdBlockingEnabledChange: (enabled: boolean) => void
}

export function Privacy ({
  contentBlockingEnabled,
  youtubeAdBlockingEnabled,
  persistenceError,
  onContentBlockingEnabledChange,
  onFilterListsUpdated,
  onYoutubeAdBlockingEnabledChange
}: PrivacyProps) {
  const isDark = useSettingsDarkMode()
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<ContentBlockingStatus>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isChanging, setIsChanging] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  const refreshStatus = useCallback(async () => {
    const nextStatus = await getContentBlockingStatus()
    if (mountedRef.current) setStatus(nextStatus)
  }, [])

  useEffect(() => {
    let active = true
    mountedRef.current = true

    void getContentBlockingStatus()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus)
      })
      .catch((error) => {
        console.warn('Unable to read content-blocking status:', error)
        if (active) setStatusError('Unable to read filter-list status.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
      mountedRef.current = false
    }
  }, [])

  async function updateLists () {
    if (isUpdating || isChanging) return
    setIsUpdating(true)
    setStatusError(null)

    try {
      const updated = await updateContentBlockingLists()
      if (!updated) throw new Error('Native content blocker is unavailable.')
      onFilterListsUpdated()
      try {
        await refreshStatus()
      } catch (error) {
        console.warn('Unable to read content-blocking status:', error)
        if (mountedRef.current) {
          setStatusError('Filter lists were updated, but their status could not be read.')
        }
      }
    } catch (error) {
      console.warn('Unable to update content-blocking lists:', error)
      if (mountedRef.current) {
        const reason = error instanceof Error ? error.message : 'Unknown update error.'
        setStatusError(`Unable to update filter lists. The current lists remain active. ${reason}`)
      }
    } finally {
      if (mountedRef.current) setIsUpdating(false)
    }
  }

  async function changeProtection (enabled: boolean) {
    if (isChanging || isUpdating) return
    setIsChanging(true)
    setStatusError(null)

    try {
      await onContentBlockingEnabledChange(enabled)
    } catch (error) {
      console.warn('Unable to change content-blocking preference:', error)
      if (mountedRef.current) {
        setStatusError(enabled
          ? 'Unable to enable protection. Check your connection and try again.'
          : 'Unable to disable protection. Try again.')
      }
    } finally {
      if (mountedRef.current) setIsChanging(false)
    }
  }

  const listDescription = isLoading
    ? 'Loading filter-list status...'
    : status
      ? `${status.lists.length} lists, ${formatBytes(status.lists.reduce((total, list) => total + list.byteLength, 0))}`
      : 'No validated filter lists are available.'

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {(persistenceError || statusError) && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError || statusError}</Text>
        </View>
      )}

      <SettingsSection title='Protection'>
        <View style={styles.settingRow}>
          <SettingCopy
            title='Block ads and trackers'
            description='Use EasyList and EasyPrivacy to block matching website requests.'
          />
          <Switch
            accessibilityLabel='Block ads and trackers'
            disabled={isChanging || isUpdating}
            value={contentBlockingEnabled}
            onValueChange={(enabled) => void changeProtection(enabled)}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={contentBlockingEnabled ? '#1f6fd1' : '#ffffff'}
          />
        </View>
      </SettingsSection>

      <SettingsSection title='YouTube'>
        <View style={styles.settingRow}>
          <SettingCopy
            title='Block YouTube ads'
            description='Apply YouTube-specific network rules.'
          />
          <Switch
            accessibilityLabel='Block YouTube ads'
            disabled={isChanging || isUpdating}
            value={youtubeAdBlockingEnabled}
            onValueChange={onYoutubeAdBlockingEnabledChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={youtubeAdBlockingEnabled ? '#1f6fd1' : '#ffffff'}
          />
        </View>
      </SettingsSection>

      <SettingsSection title='Filter lists'>
        <View style={styles.statusRow}>
          <SettingCopy
            title='EasyList and EasyPrivacy'
            description={listDescription}
          />
        </View>
        <View style={[styles.updateRow, isDark ? styles.updateRowDark : null]}>
          <SettingCopy
            title='Last updated'
            description={status ? formatUpdatedAt(status.updatedAt) : 'Not available'}
          />
          <Pressable
            accessibilityRole='button'
            accessibilityState={{ disabled: isLoading || isUpdating || isChanging }}
            disabled={isLoading || isUpdating || isChanging}
            style={({ pressed }) => [
              styles.updateButton,
              isDark ? styles.updateButtonDark : null,
              pressed ? styles.pressed : null,
              isLoading || isUpdating || isChanging ? styles.disabled : null
            ]}
            onPress={() => void updateLists()}
          >
            <Text style={[styles.updateButtonText, isDark ? styles.updateButtonTextDark : null]}>
              {isUpdating ? 'Updating...' : 'Update now'}
            </Text>
          </Pressable>
        </View>
      </SettingsSection>
    </View>
  )
}

function formatBytes (bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatUpdatedAt (updatedAt: number) {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString()
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1
  },
  pageDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16
  },
  statusRow: {
    padding: 16
  },
  updateRow: {
    alignItems: 'center',
    borderTopColor: '#e6ecf5',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 16
  },
  updateRowDark: {
    borderTopColor: BROWSER_PALETTES.dark.border
  },
  updateButton: {
    backgroundColor: '#e8f2ff',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 9
  },
  updateButtonDark: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  updateButtonText: {
    color: '#1f6fd1',
    fontSize: 13,
    fontWeight: '700'
  },
  updateButtonTextDark: {
    color: BROWSER_PALETTES.dark.selectedControl
  },
  pressed: {
    opacity: 0.65
  },
  disabled: {
    opacity: 0.5
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
  }
})
