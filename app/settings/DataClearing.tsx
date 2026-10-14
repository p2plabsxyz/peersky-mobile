import { type ComponentRef, useEffect, useRef, useState } from 'react'
import {
  Alert,
  NativeModules,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { WebView } from 'react-native-webview'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { clearWebsiteData } from '../browser-data.mjs'
import { t } from '../i18n/i18n.mjs'
import {
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'

type DataClearingProps = {
  onClearBrowsingData: () => boolean
  onClearCachedData: () => boolean
  onOpenSiteData: () => void
}

const CLEAR_WEBVIEW_TIMEOUT_MS = 5000

export function DataClearing ({
  onClearBrowsingData,
  onClearCachedData,
  onOpenSiteData
}: DataClearingProps) {
  const isDark = useSettingsDarkMode()
  const clearWebViewRef = useRef<ComponentRef<typeof WebView> | null>(null)
  const clearStartedRef = useRef(false)
  const [clearAction, setClearAction] = useState<'cache' | 'all' | null>(null)
  const isClearing = clearAction !== null

  useEffect(() => {
    if (!clearAction) return

    const timer = setTimeout(() => {
      failClearing(t('The browser cache did not respond. Please try again.'))
    }, CLEAR_WEBVIEW_TIMEOUT_MS)

    return () => clearTimeout(timer)
  }, [clearAction])

  function startClearing (action: 'cache' | 'all') {
    clearStartedRef.current = false
    setClearAction(action)
  }

  function confirmClearBrowsingData () {
    Alert.alert(
      t('Delete tabs and cached website data?'),
      Platform.OS === 'ios'
        ? t('This closes every tab and removes cached files and local website storage. Cookies and browser preferences are kept.')
        : t('This closes every tab and removes cached website files. Cookies and browser preferences are kept.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Delete'), style: 'destructive', onPress: () => startClearing('all') }
      ]
    )
  }

  function confirmClearCache () {
    Alert.alert(
      t('Clear cached website data?'),
      Platform.OS === 'ios'
        ? t('This removes cached files and local website storage without closing tabs. Cookies and browser preferences are kept.')
        : t('This removes cached website files without closing tabs. Cookies and browser preferences are kept.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Clear'), style: 'destructive', onPress: () => startClearing('cache') }
      ]
    )
  }

  function clearBrowsingData () {
    if (clearStartedRef.current) return
    clearStartedRef.current = true

    // Websites only: the app's own pages, like PeerTunes' library, stay.
    if (!clearWebsiteData({
      platform: Platform.OS,
      browserData: NativeModules.PeerSkyBrowserData,
      webViews: [clearWebViewRef.current]
    })) {
      clearStartedRef.current = false
      failClearing(t('The browser cache could not be accessed. Please try again.'))
      return
    }

    const previewCacheCleared = onClearCachedData()

    if (clearAction === 'all') {
      setClearAction(null)
      const sessionSaved = onClearBrowsingData()
      if (!previewCacheCleared || !sessionSaved) {
        Alert.alert(
          t('Data clearing incomplete'),
          !previewCacheCleared && !sessionSaved
            ? t('Your tabs were closed, but some tab preview files could not be removed and the fresh tab session could not be saved. Please try again.')
            : !previewCacheCleared
              ? t('Your tabs were closed, but some tab preview files could not be removed. Please try again.')
              : t('Your tabs were closed, but the fresh tab session could not be saved. Please try again.')
        )
      }
      return
    }

    setClearAction(null)
    Alert.alert(
      previewCacheCleared
        ? t('Cached website data cleared')
        : t('Unable to clear all cached data'),
      previewCacheCleared
        ? undefined
        : t('Some tab preview files could not be removed. Please try again.')
    )
  }

  function failClearing (message: string) {
    if (clearStartedRef.current) return
    clearStartedRef.current = true
    setClearAction(null)
    Alert.alert(t('Unable to clear cached data'), message)
  }

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {/* Clearing below keeps cookies, so nobody is signed out of every site
          at once. They go one site at a time, or all together, here. */}
      <SettingsSection title={t('Cookies')}>
        <Pressable
          accessibilityRole='button'
          style={({ pressed }) => [styles.actionRow, pressed ? styles.actionPressed : null]}
          onPress={onOpenSiteData}
        >
          <SettingCopy
            title={t('Cookies and site data')}
            description={t('See which sites keep cookies or data on this phone, and remove them.')}
          />
          <ChevronRightIcon width={16} height={16} color={isDark ? BROWSER_PALETTES.dark.mutedText : '#8190a7'} />
        </Pressable>
      </SettingsSection>

      <SettingsSection title={t('Cache')}>
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
            title={t('Clear cached website data')}
            description={Platform.OS === 'ios'
              ? t('Remove cached files and local website storage without closing tabs.')
              : t('Remove cached website files without closing your tabs.')}
          />
          <Text style={[styles.clearAction, isDark ? styles.clearActionDark : null]}>
            {clearAction === 'cache' ? t('Clearing...') : t('Clear')}
          </Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection title={t('Tabs and cache')}>
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
            title={t('Delete tabs and cached website data')}
            description={Platform.OS === 'ios'
              ? t('Close all tabs and remove cached files, local website storage, and the saved session.')
              : t('Close all tabs, clear the saved session, and remove cached website files.')}
          />
          <Text style={[styles.destructiveAction, isDark ? styles.destructiveActionDark : null]}>
            {clearAction === 'all' ? t('Deleting...') : t('Delete')}
          </Text>
        </Pressable>
      </SettingsSection>

      <View style={[styles.notice, isDark ? styles.noticeDark : null]}>
        <Text style={[styles.noticeText, isDark ? styles.noticeTextDark : null]}>
          {t('Cookies and your search, appearance, and accessibility preferences are not deleted here.')}
        </Text>
      </View>

      {isClearing && (
        <WebView
          ref={clearWebViewRef}
          accessibilityElementsHidden={true}
          source={{ html: '<!doctype html><title>Clear browser data</title>' }}
          style={styles.clearWebView}
          onError={() => failClearing(t('The browser cache could not be accessed. Please try again.'))}
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
