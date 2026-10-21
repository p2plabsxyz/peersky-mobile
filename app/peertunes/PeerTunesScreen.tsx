import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, DeviceEventEmitter, Linking, Modal, NativeEventEmitter, NativeModules, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import {
  PEERTUNES_MEDIA_BRIDGE_SCRIPT,
  PEERTUNES_MEDIA_REPORT_SCRIPT,
  PEERTUNES_SCAN_BRIDGE_SCRIPT,
  createAudioRouteScript,
  createPeerTunesMediaCommandScript,
  createPeerTunesNowPlayingScript,
  createPeerTunesPageUrl,
  isPeerTunesDataRequest,
  isPeerTunesPageRequest,
  parsePeerTunesHapticRequest,
  parsePeerTunesKeepOfflineRequest,
  parsePeerTunesKeptFoldersRequest,
  parsePeerTunesNowPlaying,
  parsePeerTunesScanRequest,
  serializeScanResult
} from './peertunes-screen.mjs'
import { AppLoading } from '../AppLoading'
import { PAUSE_ALL_MEDIA_SCRIPT } from '../browser-media.mjs'
import { t } from '../i18n/i18n.mjs'
import { parsePeerTunesWidgetTap } from '../home-shortcuts.mjs'
import { MODAL_ORIENTATIONS } from '../modal-orientations'
import { createServerTokenScript } from '../server-token.mjs'
import { WEBVIEW_DECELERATION_RATE } from '../webview-scroll.mjs'
import { tapFeedback } from '../haptics'
import { forgetPeerTunesWidgetState, idlePeerTunesWidget, updatePeerTunesWidget } from '../widgets'

const audioRoute = NativeModules.PeerSkyAudioRoute as {
  getRoute: () => Promise<{ external: boolean }>
  // Android only: the media session headset buttons talk to.
  setNowPlaying?: (playing: boolean, title: string, artist: string) => void
  clearNowPlaying?: () => void
} | undefined
// What is playing, for the Android media session and the iOS home screen
// widget. iOS gives a WebView's media to Control Center itself.
const PEERTUNES_BEFORE_LOAD_SCRIPT = `${PEERTUNES_SCAN_BRIDGE_SCRIPT}\n${PEERTUNES_MEDIA_BRIDGE_SCRIPT}`
// Android's media session sends its buttons as plain device events. On iOS
// the widget's buttons come through the module, which only sends them while
// something listens through it.
const mediaCommandEvents = Platform.OS === 'ios' && NativeModules.PeerSkyAudioRoute
  ? new NativeEventEmitter(NativeModules.PeerSkyAudioRoute)
  : DeviceEventEmitter
const AUDIO_ROUTE_POLL_MS = 3000
// Long enough for the page to have started or stopped the song.
const MEDIA_REPORT_DELAY_MS = 800

// A tap on the PeerTunes widget asks for Now Playing with the song it shows.
// The app brings PeerTunes forward by itself; this hands the song to the page,
// which may not be open yet: PeerTunes can be closed, or the whole app can be
// starting from the tap. Heard at module scope, so a tap that comes before
// the screen mounts still counts. A page that loads within a minute gets it,
// including one that reloads straight after.
const WIDGET_TAP_MS = 60 * 1000
type WidgetTap = { song: string, at: number }
let widgetTap: WidgetTap | null = null
const widgetTapListeners = new Set<() => void>()
function hearWidgetTap (url: string | null) {
  const tap = parsePeerTunesWidgetTap(url)
  if (!tap) return
  widgetTap = { song: tap.song, at: Date.now() }
  for (const listener of widgetTapListeners) listener()
}
Linking.addEventListener('url', (event) => hearWidgetTap(event.url))
void Linking.getInitialURL().then(hearWidgetTap).catch(() => {})

type Props = {
  error: string | null
  isDark: boolean
  launchSuffix: string
  localUrl: string | null
  // The server's token for this run. Reading a drive or keeping songs needs it.
  serverToken: string | null
  onEnsureServer: () => void
  onKeepOffline: (url: string) => Promise<{ ok: boolean, status?: string, error?: string }>
  onKeptFolders: (urls: string[]) => Promise<{ ok: boolean, kept?: string[], error?: string }>
  // Goes up each time folders are removed in Settings, P2P Data.
  offlineFoldersVersion: number
  onOpenUrl: (url: string) => void
  onStatus: (message: string) => void
}

export function PeerTunesScreen ({
  error,
  isDark,
  launchSuffix,
  localUrl,
  serverToken,
  onEnsureServer,
  onKeepOffline,
  onKeptFolders,
  offlineFoldersVersion,
  onOpenUrl,
  onStatus
}: Props) {
  // Android kills a backgrounded WebView's render process under memory
  // pressure and leaves an empty view behind. Remounting on that signal is
  // what stops the player going blank until the tab is closed and reopened.
  const [reloadNonce, setReloadNonce] = useState(0)
  // A restarted server has a new token, which a page only gets as it loads,
  // so a new one loads the page again.
  const [tokenRun, setTokenRun] = useState({ token: serverToken, run: 0 })
  if (tokenRun.token !== serverToken) setTokenRun({ token: serverToken, run: tokenRun.run + 1 })
  const [scanRequestId, setScanRequestId] = useState<string | null>(null)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const webViewRef = useRef<WebView | null>(null)
  const scanHandledRef = useRef(false)
  const pageLoadedRef = useRef(false)

  // The widget's song goes to a page that has loaded: now, or when it has.
  const showWidgetSong = useCallback(() => {
    const tap = widgetTap
    if (!tap || !pageLoadedRef.current) return
    if (Date.now() - tap.at > WIDGET_TAP_MS) {
      widgetTap = null
      return
    }
    webViewRef.current?.injectJavaScript(createPeerTunesNowPlayingScript(tap.song))
  }, [])

  useEffect(() => {
    widgetTapListeners.add(showWidgetSong)
    return () => { widgetTapListeners.delete(showWidgetSong) }
  }, [showWidgetSong])

  // The message says what PeerTunes was reloaded after.
  const recover = useCallback((message: string) => {
    onStatus(message)
    onEnsureServer()
    setReloadNonce((value) => value + 1)
  }, [onEnsureServer, onStatus])

  // The loopback server lives in the Bare worklet, which can be torn down
  // while the app sits in the background. Re-check it whenever we come back.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') onEnsureServer()
    })
    return () => subscription.remove()
  }, [onEnsureServer])

  // Buttons on earbuds, in a car or on the home screen widget come back as
  // commands for the page. A swipe away pauses it, since the app can stay
  // running for PeerChat with nothing left on screen to stop the music.
  useEffect(() => {
    let reportTimer: ReturnType<typeof setTimeout> | null = null
    const commands = mediaCommandEvents.addListener('PeerSkyMediaCommand', (command: unknown) => {
      const script = createPeerTunesMediaCommandScript(command)
      if (!script) return
      webViewRef.current?.injectJavaScript(script)
      // The widget showed the press before the page acted on it. Ask the page
      // what it is doing now, so the widget ends up right either way.
      forgetPeerTunesWidgetState()
      if (reportTimer) clearTimeout(reportTimer)
      reportTimer = setTimeout(() => {
        webViewRef.current?.injectJavaScript(PEERTUNES_MEDIA_REPORT_SCRIPT)
      }, MEDIA_REPORT_DELAY_MS)
    })
    const removed = DeviceEventEmitter.addListener('PeerSkyTaskRemoved', () => {
      webViewRef.current?.injectJavaScript(PAUSE_ALL_MEDIA_SCRIPT)
    })
    return () => {
      if (reportTimer) clearTimeout(reportTimer)
      commands.remove()
      removed.remove()
      audioRoute?.clearNowPlaying?.()
      idlePeerTunesWidget()
    }
  }, [])

  // The Bluetooth mark. The app looks at the audio route and tells the page
  // whenever the answer changes, and again whenever the page loads.
  const audioExternalRef = useRef<boolean | null>(null)
  const pushAudioRoute = useCallback(async () => {
    if (!audioRoute) return
    try {
      const { external } = await audioRoute.getRoute()
      if (external === audioExternalRef.current) return
      audioExternalRef.current = external
      webViewRef.current?.injectJavaScript(createAudioRouteScript(external))
    } catch {}
  }, [])

  useEffect(() => {
    if (!localUrl || !audioRoute) return
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void pushAudioRoute()
    }, AUDIO_ROUTE_POLL_MS)
    return () => clearInterval(timer)
  }, [localUrl, pushAudioRoute])

  // The page asks for a scan, native runs the camera and hands the text back.
  // WKWebView has no BarcodeDetector, and even where it does the native scanner
  // is the one the rest of the app already uses.
  const finishScan = useCallback((value: string | null) => {
    const requestId = scanRequestId
    setScanRequestId(null)
    if (!requestId) return
    webViewRef.current?.injectJavaScript(
      `window.__peerskyResolveScan(${serializeScanResult(requestId)}, ${serializeScanResult(value)}); true;`
    )
  }, [scanRequestId])

  // PeerSky downloads a hyper folder when asked; the page asks on behalf of a
  // playlist that was just imported, so it plays with the network off.
  const keepOffline = useCallback(async (requestId: string, url: string) => {
    let answer: { ok: boolean, status?: string, error?: string }
    try {
      answer = await onKeepOffline(url)
    } catch (error) {
      answer = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    webViewRef.current?.injectJavaScript(
      // Through the same escaping as a scan result: an error message carrying a
      // line separator is valid JSON and a broken JavaScript string, which would
      // leave the page waiting on a promise that never settles.
      `window.__peerskyResolveScan(${serializeScanResult(requestId)}, ${serializeScanResult(answer)}); true;`
    )
  }, [onKeepOffline])

  // The page asks which of its folders are still kept on the device, and
  // drops the songs of any that were removed.
  const keptFolders = useCallback(async (requestId: string, urls: string[]) => {
    let answer: { ok: boolean, kept?: string[], error?: string }
    try {
      answer = await onKeptFolders(urls)
    } catch (error) {
      answer = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    webViewRef.current?.injectJavaScript(
      `window.__peerskyResolveScan(${serializeScanResult(requestId)}, ${serializeScanResult(answer)}); true;`
    )
  }, [onKeptFolders])

  // Folders removed while PeerTunes is open: it checks again, so their songs
  // leave the library without a reload.
  useEffect(() => {
    if (!offlineFoldersVersion) return
    webViewRef.current?.injectJavaScript('window.PT && window.PT.syncKeptFolders && window.PT.syncKeptFolders(); true;')
  }, [offlineFoldersVersion])

  const beginScan = useCallback(async (requestId: string) => {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission()

    if (!permission?.granted) {
      webViewRef.current?.injectJavaScript(
        `window.__peerskyResolveScan(${serializeScanResult(requestId)}, null); true;`
      )
      onStatus(t('Camera access is needed to scan a QR code'))
      return
    }

    scanHandledRef.current = false
    setScanRequestId(requestId)
  }, [cameraPermission, onStatus, requestCameraPermission])

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.message, isDark ? styles.messageDark : null]}>{error}</Text>
        <Pressable
          accessibilityRole='button'
          onPress={() => recover(t('PeerTunes reloaded after a retry'))}
          style={styles.retry}
        >
          <Text style={styles.retryText}>{t('Try again')}</Text>
        </Pressable>
      </View>
    )
  }

  if (!localUrl || !serverToken) {
    return (
      <AppLoading app='peertunes' isDark={isDark} />
    )
  }

  const pageUrl = createPeerTunesPageUrl(localUrl, launchSuffix)

  return (
    <>
    <WebView
      key={`${pageUrl}:${reloadNonce}:${tokenRun.run}`}
      ref={webViewRef}
      source={{ uri: pageUrl }}
      // This view only ever shows the loopback app, so pin it. The navigation
      // handler below is the real gate; this is the second layer behind it.
      originWhitelist={[localUrl]}
      // Left unset, react-native-webview gives iOS a deceleration of 0, and a
      // swipe through the library stopped the moment the finger lifted.
      decelerationRate={WEBVIEW_DECELERATION_RATE}
      // The token goes in before the page's own scripts run. The server never
      // sends it, so only this view has it.
      injectedJavaScriptBeforeContentLoaded={`${createServerTokenScript(serverToken)}\n${PEERTUNES_BEFORE_LOAD_SCRIPT}`}
      onMessage={(event) => {
        const nowPlaying = parsePeerTunesNowPlaying(event.nativeEvent.data)
        if (nowPlaying) {
          audioRoute?.setNowPlaying?.(nowPlaying.playing, nowPlaying.title, nowPlaying.artist)
          updatePeerTunesWidget(nowPlaying)
          return
        }
        const weight = parsePeerTunesHapticRequest(event.nativeEvent.data)
        if (weight) {
          tapFeedback(weight)
          return
        }
        const keep = parsePeerTunesKeepOfflineRequest(event.nativeEvent.data)
        if (keep) {
          void keepOffline(keep.requestId, keep.url)
          return
        }
        const kept = parsePeerTunesKeptFoldersRequest(event.nativeEvent.data)
        if (kept) {
          void keptFolders(kept.requestId, kept.urls)
          return
        }
        const requestId = parsePeerTunesScanRequest(event.nativeEvent.data)
        if (requestId) void beginScan(requestId)
      }}
      allowsInlineMediaPlayback={true}
      allowsProtectedMedia={true}
      androidLayerType='hardware'
      cacheEnabled={false}
      domStorageEnabled={true}
      mediaCapturePermissionGrantType='prompt'
      mediaPlaybackRequiresUserAction={false}
      setBuiltInZoomControls={false}
      textZoom={100}
      style={styles.webView}
      onShouldStartLoadWithRequest={(request) => {
        if (isPeerTunesDataRequest(request.url, localUrl)) return false
        if (isPeerTunesPageRequest(request.url, localUrl)) return true
        // Only a real top-frame navigation should leave PeerTunes. A subframe
        // pointing elsewhere used to take the whole tab with it and stop the
        // music, without the user touching anything.
        if (request.isTopFrame === false) return false
        onOpenUrl(request.url)
        return false
      }}
      onOpenWindow={(event) => {
        if (isPeerTunesDataRequest(event.nativeEvent.targetUrl, localUrl)) return
        onOpenUrl(event.nativeEvent.targetUrl)
      }}
      onLoadStart={() => { pageLoadedRef.current = false }}
      onLoadEnd={() => {
        audioExternalRef.current = null
        void pushAudioRoute()
        pageLoadedRef.current = true
        showWidgetSong()
      }}
      onRenderProcessGone={() => recover(t('PeerTunes reloaded after a renderer restart'))}
      onContentProcessDidTerminate={() => recover(t('PeerTunes reloaded after a renderer restart'))}
      onError={(event) => {
        recover(t('PeerTunes reloaded after a load failure ({error})', { error: event.nativeEvent.description }))
      }}
    />
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      onRequestClose={() => finishScan(null)}
      visible={scanRequestId !== null}
    >
      {/* Its own root view on iOS: without a provider the overlay got no insets. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.scanner}>
        {scanRequestId !== null && (
          <CameraView
            style={StyleSheet.absoluteFillObject}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanHandledRef.current) return
              scanHandledRef.current = true
              finishScan(data)
            }}
          />
        )}
        <SafeAreaView style={styles.scannerOverlay} edges={['top', 'right', 'bottom', 'left']}>
          <Text style={styles.scanHint}>{t('Align the QR code inside the frame')}</Text>
          <Pressable
            accessibilityRole='button'
            onPress={() => finishScan(null)}
            style={styles.scannerClose}
          >
            <Text style={styles.scannerCloseText}>{t('Cancel')}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
      </SafeAreaProvider>
    </Modal>
    </>
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
    color: '#1f2027',
    fontSize: 15,
    textAlign: 'center'
  },
  messageDark: {
    color: '#e6e6ea'
  },
  scanner: {
    backgroundColor: '#000000',
    flex: 1
  },
  scannerOverlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 24
  },
  scanHint: {
    color: '#ffffff',
    fontSize: 15,
    marginBottom: 16,
    textAlign: 'center'
  },
  scannerClose: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 28
  },
  scannerCloseText: {
    color: '#1f2027',
    fontSize: 15,
    fontWeight: '700'
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
    backgroundColor: '#0a0b0d',
    flex: 1
  }
})
