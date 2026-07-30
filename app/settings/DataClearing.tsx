import { type ComponentRef, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { WebView } from 'react-native-webview'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { clearBrowserWebViewData } from '../browser-data.mjs'
import {
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'

type DataClearingProps = {
  onClearBrowsingData: () => boolean
  onClearCachedData: () => boolean
}

const CLEAR_WEBVIEW_TIMEOUT_MS = 5000

export function DataClearing ({
  onClearBrowsingData,
  onClearCachedData
}: DataClearingProps) {
  const isDark = useSettingsDarkMode()
  const clearWebViewRef = useRef<ComponentRef<typeof WebView> | null>(null)
  const clearStartedRef = useRef(false)
  const [clearAction, setClearAction] = useState<'cache' | 'all' | null>(null)
  const isClearing = clearAction !== null

  useEffect(() => {
    if (!clearAction) return

    const timer = setTimeout(() => {
      failClearing('The browser cache did not respond. Please try again.')
    }, CLEAR_WEBVIEW_TIMEOUT_MS)

    return () => clearTimeout(timer)
  }, [clearAction])

  function startClearing (action: 'cache' | 'all') {
    clearStartedRef.current = false
    setClearAction(action)
  }

  function confirmClearBrowsingData () {
    Alert.alert(
      'Delete tabs and cached website data?',
      Platform.OS === 'ios'
        ? 'This closes every tab and removes cached files and local website storage. Cookies and browser preferences are kept.'
        : 'This closes every tab and removes cached website files. Cookies and browser preferences are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => startClearing('all') }
      ]
    )
  }

  function confirmClearCache () {
    Alert.alert(
      'Clear cached website data?',
      Platform.OS === 'ios'
        ? 'This removes cached files and local website storage without closing tabs. Cookies and browser preferences are kept.'
        : 'This removes cached website files without closing tabs. Cookies and browser preferences are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => startClearing('cache') }
      ]
    )
  }

  function clearBrowsingData () {
    if (clearStartedRef.current) return
    clearStartedRef.current = true

    if (!clearBrowserWebViewData(clearWebViewRef.current)) {
      clearStartedRef.current = false
      failClearing('The browser cache could not be accessed. Please try again.')
      return
    }

    const previewCacheCleared = onClearCachedData()

    if (clearAction === 'all') {
      setClearAction(null)
      const sessionSaved = onClearBrowsingData()
      if (!previewCacheCleared || !sessionSaved) {
        const failedParts = [
          !previewCacheCleared ? 'some tab preview files could not be removed' : null,
          !sessionSaved ? 'the fresh tab session could not be saved' : null
        ].filter(Boolean)
        Alert.alert(
          'Data clearing incomplete',
          `Your tabs were closed, but ${failedParts.join(' and ')}. Please try again.`
        )
      }
      return
    }

    setClearAction(null)
    Alert.alert(
      previewCacheCleared
        ? 'Cached website data cleared'
        : 'Unable to clear all cached data',
      previewCacheCleared
        ? undefined
        : 'Some tab preview files could not be removed. Please try again.'
    )
  }

  function failClearing (message: string) {
    if (clearStartedRef.current) return
    clearStartedRef.current = true
    setClearAction(null)
    Alert.alert('Unable to clear cached data', message)
  }

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      <SettingsSection title='Cache'>
        <Pressable
          accessibilityRole='button'
          disabled={isClearing}
          style={({ pressed }) => [
            styles.actionRow,
            pressed ? styles.actionPressed : null,
            isClearing ? styles.actionDisabled : null
          ]}
          onPress={confirmClearCache}
        >
          <SettingCopy
            title='Clear cached website data'
            description={Platform.OS === 'ios'
              ? 'Remove cached files and local website storage without closing tabs.'
              : 'Remove cached website files without closing your tabs.'}
          />
          <Text style={[styles.clearAction, isDark ? styles.clearActionDark : null]}>
            {clearAction === 'cache' ? 'Clearing...' : 'Clear'}
          </Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title='Tabs and cache'>
        <Pressable
          accessibilityRole='button'
          disabled={isClearing}
          style={({ pressed }) => [
            styles.actionRow,
            pressed ? styles.actionPressed : null,
            isClearing ? styles.actionDisabled : null
          ]}
          onPress={confirmClearBrowsingData}
        >
          <SettingCopy
            title='Delete tabs and cached website data'
            description={Platform.OS === 'ios'
              ? 'Close all tabs and remove cached files, local website storage, and the saved session.'
              : 'Close all tabs, clear the saved session, and remove cached website files.'}
          />
          <Text style={[styles.destructiveAction, isDark ? styles.destructiveActionDark : null]}>
            {clearAction === 'all' ? 'Deleting...' : 'Delete'}
          </Text>
        </Pressable>
      </SettingsSection>

      <View style={[styles.notice, isDark ? styles.noticeDark : null]}>
        <Text style={[styles.noticeText, isDark ? styles.noticeTextDark : null]}>
          Cookies, search, appearance, and accessibility preferences are not deleted.
        </Text>
      </View>

      {isClearing && (
        <WebView
          ref={clearWebViewRef}
          accessibilityElementsHidden={true}
          source={{ html: '<!doctype html><title>Clear browser data</title>' }}
          style={styles.clearWebView}
          onError={() => failClearing('The browser cache could not be accessed. Please try again.')}
          onLoadEnd={clearBrowsingData}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1
  },
  pageDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 76,
    padding: 16
  },
  actionPressed: {
    opacity: 0.65
  },
  actionDisabled: {
    opacity: 0.6
  },
  destructiveAction: {
    color: '#a7354a',
    fontSize: 14,
    fontWeight: '800'
  },
  clearAction: {
    color: '#1f6fd1',
    fontSize: 14,
    fontWeight: '800'
  },
  clearActionDark: {
    color: '#8fc1ff'
  },
  destructiveActionDark: {
    color: '#ff9aad'
  },
  notice: {
    paddingHorizontal: 20,
    paddingVertical: 16
  },
  noticeDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  noticeText: {
    color: '#687086',
    fontSize: 13,
    lineHeight: 18
  },
  noticeTextDark: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  clearWebView: {
    height: 1,
    opacity: 0,
    position: 'absolute',
    width: 1
  }
})
