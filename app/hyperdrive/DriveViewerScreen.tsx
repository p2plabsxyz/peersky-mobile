import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'

import {
  createDriveViewerConfigScript,
  createDriveViewerPageUrl,
  isDriveViewerOrigin,
  isDriveViewerPageRequest,
  parseDriveViewerMessage,
  viewerStringKeys
} from './drive-viewer.mjs'
import viewerStrings from '../i18n/viewer-strings.json'
import { catalogEntries, getLanguage, t } from '../i18n/i18n.mjs'
import { WEBVIEW_DECELERATION_RATE } from '../webview-scroll.mjs'

// The viewer is handed these texts of the catalog in force and nothing more:
// the ones its scripts translate, as scripts/i18n.mjs lists them.
const VIEWER_STRING_KEYS = viewerStringKeys(viewerStrings)

export type DriveViewerHistory = { canGoBack: boolean, canGoForward: boolean }
export type DriveViewerNavigation = { goBack: () => boolean, goForward: () => boolean }
// The viewer's server as it runs now: where it is, the secret this run's
// reads of drives need, and a count that moves on whenever either changes.
export type DriveViewerServer = { localUrl: string, token: string, run: number }

type Props = {
  // The tab's peersky://p2p/hyperdrive/... address.
  url: string
  // The viewer's server, once it is running.
  server: DriveViewerServer | null
  // Why the server did not start.
  error: string | null
  isDark: boolean
  incognito: boolean
  // See hyperdriveViewerEpoch in settings/browser-preferences.mjs.
  epoch: number
  backgroundColor: string
  textColor: string
  onEnsureServer: () => void
  onRoute: (url: string, title: string) => void
  onDownload: (url: string, name: string) => void
  onOpen: (url: string) => void
  onCopy: (text: string) => void
  onShare: (url: string, name: string) => void
  // Back and forward step through the viewer's own folders first.
  onHistoryChange: (history: DriveViewerHistory) => void
  registerNavigation: (navigation: DriveViewerNavigation | null) => void
}

/**
 * The Files, Photos and Videos views of a hyper:// folder: the viewer's page,
 * from its server on 127.0.0.1, in the tab with the browser's bars around it.
 * The page moves between folders itself and says where it is now, which
 * becomes the tab's address, so that address changing does not load it again.
 */
export function DriveViewerScreen ({
  url,
  server,
  error,
  isDark,
  incognito,
  epoch,
  backgroundColor,
  textColor,
  onEnsureServer,
  onRoute,
  onDownload,
  onOpen,
  onCopy,
  onShare,
  onHistoryChange,
  registerNavigation
}: Props) {
  const [reloadNonce, setReloadNonce] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const webViewRef = useRef<WebView | null>(null)
  const historyRef = useRef<DriveViewerHistory>({ canGoBack: false, canGoForward: false })
  const callbacksRef = useRef({ onEnsureServer, onHistoryChange })
  callbacksRef.current = { onEnsureServer, onHistoryChange }

  const localUrl = server?.localUrl || null
  // Only for the page, through its config, and for checking that nothing the
  // page sends out carries it.
  const token = server?.token || null

  // The page is loaded again only for something the page cannot follow by
  // itself: another theme or language, a new epoch, a server started again,
  // with a new secret, or a reload. It then opens where the tab is now, not
  // where it began.
  const language = getLanguage()
  const mountKey = `${isDark ? 'dark' : 'light'}:${language}:${incognito ? 'incognito' : 'normal'}:${epoch}:${server?.run || 0}:${reloadNonce}`
  const latestUrlRef = useRef(url)
  latestUrlRef.current = url
  const mountRef = useRef({ key: mountKey, url })
  if (mountRef.current.key !== mountKey) mountRef.current = { key: mountKey, url: latestUrlRef.current }
  const pageUrl = localUrl ? createDriveViewerPageUrl(localUrl, mountRef.current.url) : null

  const configScript = useMemo(() => createDriveViewerConfigScript({
    platform: Platform.OS,
    language,
    strings: catalogEntries(VIEWER_STRING_KEYS),
    dark: isDark,
    incognito,
    epoch,
    token
  }, { localUrl: localUrl || undefined }), [epoch, incognito, isDark, language, localUrl, token])

  // The server lives in the Bare worklet, which can be torn down while the
  // app is in the background. Asked again for one that runs, it just answers.
  useEffect(() => {
    callbacksRef.current.onEnsureServer()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') callbacksRef.current.onEnsureServer()
    })
    return () => subscription.remove()
  }, [])

  // A page loaded again starts with no history of its own.
  useEffect(() => {
    historyRef.current = { canGoBack: false, canGoForward: false }
    callbacksRef.current.onHistoryChange(historyRef.current)
  }, [mountKey])

  useEffect(() => {
    registerNavigation({
      goBack: () => {
        if (!historyRef.current.canGoBack || !webViewRef.current) return false
        webViewRef.current.goBack()
        return true
      },
      goForward: () => {
        if (!historyRef.current.canGoForward || !webViewRef.current) return false
        webViewRef.current.goForward()
        return true
      }
    })
    return () => {
      registerNavigation(null)
      callbacksRef.current.onHistoryChange({ canGoBack: false, canGoForward: false })
    }
  }, [registerNavigation])

  function reload () {
    setLoadError(false)
    onEnsureServer()
    setReloadNonce((value) => value + 1)
  }

  function openOutside (targetUrl: string) {
    const message = parseDriveViewerMessage(JSON.stringify({ type: 'open', url: targetUrl }), { secret: token })
    if (message?.type === 'open') onOpen(message.url)
  }

  if (error || loadError || (localUrl && !pageUrl)) {
    return (
      <View style={[styles.centered, { backgroundColor }]}>
        <Text style={[styles.message, { color: textColor }]}>
          {error || t('This folder could not be opened.')}
        </Text>
        <Pressable accessibilityRole='button' onPress={reload} style={styles.retry}>
          <Text style={styles.retryText}>{t('Try again')}</Text>
        </Pressable>
      </View>
    )
  }

  if (!localUrl || !pageUrl) {
    return (
      <View style={[styles.centered, { backgroundColor }]} accessibilityLabel={t('Opening...')}>
        <ActivityIndicator color={textColor} size='small' />
      </View>
    )
  }

  return (
    <WebView
      key={mountKey}
      ref={webViewRef}
      source={{ uri: pageUrl }}
      originWhitelist={['*']}
      injectedJavaScriptBeforeContentLoaded={configScript}
      // Left unset, react-native-webview gives iOS a deceleration of 0, and a
      // swipe through a long grid stopped the moment the finger lifted.
      decelerationRate={WEBVIEW_DECELERATION_RATE}
      // The browser's own edge swipe walks back, through the viewer first.
      allowsBackForwardNavigationGestures={false}
      allowsFullscreenVideo={true}
      allowsInlineMediaPlayback={true}
      // The viewer reads a frame of each video for its poster, muted and out
      // of sight, before anyone has pressed anything.
      mediaPlaybackRequiresUserAction={false}
      androidLayerType='hardware'
      // Nothing from a private drive goes in the WebView's disk cache. The
      // server says no-store as well.
      cacheEnabled={false}
      domStorageEnabled={true}
      // An incognito tab's viewer keeps nothing past the tab. Android's
      // incognito prop empties every tab's cookies, so there the viewer is
      // told instead, and keeps what it makes in memory.
      incognito={Platform.OS === 'ios' && incognito}
      setBuiltInZoomControls={false}
      textZoom={100}
      webviewDebuggingEnabled={__DEV__}
      style={[styles.webView, { backgroundColor }]}
      onShouldStartLoadWithRequest={(request) => {
        if (isDriveViewerPageRequest(request.url, localUrl)) return true
        // Only a real navigation leaves the viewer, and into a tab of its
        // own. A file of the drive never opens in its place.
        if (request.isTopFrame !== false) openOutside(request.url)
        return false
      }}
      onOpenWindow={(event) => openOutside(event.nativeEvent.targetUrl)}
      onNavigationStateChange={(state) => {
        if (!isDriveViewerOrigin(state.url, localUrl)) return
        const next = { canGoBack: state.canGoBack === true, canGoForward: state.canGoForward === true }
        if (next.canGoBack === historyRef.current.canGoBack && next.canGoForward === historyRef.current.canGoForward) return
        historyRef.current = next
        onHistoryChange(next)
      }}
      onMessage={(event) => {
        if (!isDriveViewerOrigin(event.nativeEvent.url, localUrl)) return
        const message = parseDriveViewerMessage(event.nativeEvent.data, { secret: token })
        if (!message) return
        if (message.type === 'route') onRoute(message.url, message.title)
        else if (message.type === 'download') onDownload(message.url, message.name)
        else if (message.type === 'open') onOpen(message.url)
        else if (message.type === 'copy') onCopy(message.text)
        else if (message.type === 'share') onShare(message.url, message.name)
      }}
      // iOS and Android reclaim a backgrounded WebView's renderer and leave it
      // blank. The viewer loads again where the tab is.
      onContentProcessDidTerminate={() => setReloadNonce((value) => value + 1)}
      onRenderProcessGone={() => setReloadNonce((value) => value + 1)}
      onError={() => setLoadError(true)}
      onHttpError={() => setLoadError(true)}
    />
  )
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24
  },
  message: {
    fontSize: 15,
    textAlign: 'center'
  },
  retry: {
    alignItems: 'center',
    backgroundColor: '#2f6fed',
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 24
  },
  retryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700'
  },
  webView: {
    flex: 1
  }
})
