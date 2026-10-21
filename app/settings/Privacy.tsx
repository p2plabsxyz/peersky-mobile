import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { t, tp } from '../i18n/i18n.mjs'
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
  onOpenUrl: (url: string) => void
  onYoutubeAdBlockingEnabledChange: (enabled: boolean) => void
}

export function Privacy ({
  contentBlockingEnabled,
  youtubeAdBlockingEnabled,
  persistenceError,
  onContentBlockingEnabledChange,
  onFilterListsUpdated,
  onOpenUrl,
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
        if (active) setStatusError(t('Unable to read filter-list status.'))
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
      if (!updated) throw new Error(t('Native content blocker is unavailable.'))
      onFilterListsUpdated()
      try {
        await refreshStatus()
      } catch (error) {
        console.warn('Unable to read content-blocking status:', error)
        if (mountedRef.current) {
          setStatusError(t('Filter lists were updated, but their status could not be read.'))
        }
      }
    } catch (error) {
      console.warn('Unable to update content-blocking lists:', error)
      if (mountedRef.current) {
        const reason = error instanceof Error ? error.message : t('Unknown update error.')
        setStatusError(t('Unable to update filter lists. The current lists remain active. {reason}', { reason }))
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
          ? t('Unable to enable protection. Check your connection and try again.')
          : t('Unable to disable protection. Try again.'))
      }
    } finally {
      if (mountedRef.current) setIsChanging(false)
    }
  }

  const listSize = status ? formatBytes(status.lists.reduce((total, list) => total + list.byteLength, 0)) : ''
  // The English has always said "lists", whatever the count.
  const listDescription = isLoading
    ? t('Loading filter-list status...')
    : status
      ? tp({ one: '{count} lists, {size}', other: '{count} lists, {size}' }, status.lists.length, { size: listSize })
      : t('No validated filter lists are available.')

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {(persistenceError || statusError) && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError || statusError}</Text>
        </View>
      )}

      <SettingsSection title={t('Protection')}>
        <View style={styles.settingRow}>
          <SettingCopy
            title={t('Block ads and trackers')}
            description={t('Use EasyList and EasyPrivacy to block matching website requests.')}
          />
          <Switch
            accessibilityLabel={t('Block ads and trackers')}
            disabled={isChanging || isUpdating}
            value={contentBlockingEnabled}
            onValueChange={(enabled) => void changeProtection(enabled)}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={contentBlockingEnabled ? '#1f6fd1' : '#ffffff'}
          />
        </View>
        {/* Nobody should take a browser's word for this, least of all ours.
            The EFF's test is run by people with no stake in the answer. */}
        <Pressable
          accessibilityLabel={t('Open the Cover Your Tracks test')}
          accessibilityRole='link'
          style={styles.linkRow}
          onPress={() => onOpenUrl('https://coveryourtracks.eff.org/')}
        >
          <SettingCopy
            title={t('Test this browser')}
            description={t('Cover Your Tracks, from the Electronic Frontier Foundation, shows what trackers can see when you visit a page.')}
          />
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
      </SettingsSection>

      <SettingsSection title='YouTube'>
        <View style={styles.settingRow}>
          <SettingCopy
            title={t('Block YouTube ads')}
            description={t('Apply YouTube-specific network rules.')}
          />
          <Switch
            accessibilityLabel={t('Block YouTube ads')}
            disabled={isChanging || isUpdating}
            value={youtubeAdBlockingEnabled}
            onValueChange={onYoutubeAdBlockingEnabledChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={youtubeAdBlockingEnabled ? '#1f6fd1' : '#ffffff'}
          />
        </View>
      </SettingsSection>

      <SettingsSection title={t('Filter lists')}>
        <View style={styles.statusRow}>
          <SettingCopy
            title={t('EasyList and EasyPrivacy')}
            description={listDescription}
          />
        </View>
        <View style={[styles.updateRow, isDark ? styles.updateRowDark : null]}>
          <SettingCopy
            title={t('Last updated')}
            description={status ? formatUpdatedAt(status.updatedAt) : t('Not available')}
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
              {isUpdating ? t('Updating...') : t('Update now')}
            </Text>
          </Pressable>
        </View>
        {/* The lists come with the app and are shared under CC BY-SA 3.0,
            which asks that whoever passes them on names the authors. */}
        <Pressable
          accessibilityLabel={t('Open {name}', { name: 'easylist.to' })}
          accessibilityRole='link'
          style={styles.linkRow}
          onPress={() => onOpenUrl('https://easylist.to/')}
        >
          <SettingCopy
            title={t('Made by the EasyList authors')}
            description={t('EasyList and EasyPrivacy are from easylist.to, used under the Creative Commons Attribution-ShareAlike 3.0 license.')}
          />
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
      </SettingsSection>

      <SettingsSection title={t('Privacy policy and terms')}>
        <Pressable
          accessibilityLabel={t('Open PeerSky privacy policy')}
          accessibilityRole='link'
          style={styles.linkRow}
          onPress={() => onOpenUrl('https://github.com/p2plabsxyz/peersky-mobile/blob/main/PRIVACY.md')}
        >
          <SettingCopy
            title={t('Read privacy policy')}
            description={t('Learn how PeerSky handles browser and device data.')}
          />
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
        <Pressable
          accessibilityLabel={t('Open PeerSky terms of use')}
          accessibilityRole='link'
          style={styles.linkRow}
          onPress={() => onOpenUrl('https://github.com/p2plabsxyz/peersky-mobile/blob/main/TERMS.md')}
        >
          <SettingCopy
            title={t('Read terms of use')}
            description={t('The rules for PeerChat, how reports are handled, and how to send a copyright notice.')}
          />
          <ChevronRightIcon
            width={16}
            height={16}
            color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'}
          />
        </Pressable>
      </SettingsSection>
    </View>
  )
}

function formatBytes (bytes: number) {
  return t('{size} MB', { size: (bytes / (1024 * 1024)).toFixed(1) })
}

function formatUpdatedAt (updatedAt: number) {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime()) ? t('Not available') : date.toLocaleString()
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
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16
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
