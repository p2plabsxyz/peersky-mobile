import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, DeviceEventEmitter, Modal, NativeEventEmitter, NativeModules, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import {
  PEERTUNES_MEDIA_BRIDGE_SCRIPT,
  PEERTUNES_MEDIA_REPORT_SCRIPT,
  PEERTUNES_SCAN_BRIDGE_SCRIPT,
  createAudioRouteScript,
  createPeerTunesMediaCommandScript,
  createPeerTunesPageUrl,
  isPeerTunesPageRequest,
  parsePeerTunesHapticRequest,
  parsePeerTunesKeepOfflineRequest,
  parsePeerTunesNowPlaying,
  parsePeerTunesScanRequest,
  serializeScanResult
} from './peertunes-screen.mjs'
import { AppLoading } from '../AppLoading'
import { PAUSE_ALL_MEDIA_SCRIPT } from '../browser-media.mjs'
import { MODAL_ORIENTATIONS } from '../modal-orientations'
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

type Props = {
  error: string | null
  isDark: boolean
  launchSuffix: string
  localUrl: string | null
  onEnsureServer: () => void
  onKeepOffline: (url: string) => Promise<{ ok: boolean, status?: string, error?: string }>
  onOpenUrl: (url: string) => void
  onStatus: (message: string) => void
}

export function PeerTunesScreen ({
  error,
  isDark,
  launchSuffix,
  localUrl,
  onEnsureServer,
  onKeepOffline,
  onOpenUrl,
  onStatus
}: Props) {
  // Android kills a backgrounded WebView's render process under memory
  // pressure and leaves an empty view behind. Remounting on that signal is
  // what stops the player going blank until the tab is closed and reopened.
  const [reloadNonce, setReloadNonce] = useState(0)
  const [scanRequestId, setScanRequestId] = useState<string | null>(null)
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()
  const webViewRef = useRef<WebView | null>(null)
  const scanHandledRef = useRef(false)

  const recover = useCallback((reason: string) => {
    onStatus(`PeerTunes reloaded after ${reason}`)
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

  const beginScan = useCallback(async (requestId: string) => {
    const permission = cameraPermission?.granted
      ? cameraPermission
      : await requestCameraPermission()

    if (!permission?.granted) {
      webViewRef.current?.injectJavaScript(
        `window.__peerskyResolveScan(${serializeScanResult(requestId)}, null); true;`
      )
      onStatus('Camera access is needed to scan a QR code')
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
          onPress={() => recover('a retry')}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    )
  }

  if (!localUrl) {
    return (
      <AppLoading app='peertunes' isDark={isDark} />
    )
  }

  const pageUrl = createPeerTunesPageUrl(localUrl, launchSuffix)

  return (
    <>
    <WebView
      key={`${pageUrl}:${reloadNonce}`}
      ref={webViewRef}
      source={{ uri: pageUrl }}
      // This view only ever shows the loopback app, so pin it. The navigation
      // handler below is the real gate; this is the second layer behind it.
      originWhitelist={[localUrl]}
      injectedJavaScriptBeforeContentLoaded={PEERTUNES_BEFORE_LOAD_SCRIPT}
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
        if (isPeerTunesPageRequest(request.url, localUrl)) return true
        // Only a real top-frame navigation should leave PeerTunes. A subframe
        // pointing elsewhere used to take the whole tab with it and stop the
        // music, without the user touching anything.
        if (request.isTopFrame === false) return false
        onOpenUrl(request.url)
        return false
      }}
      onOpenWindow={(event) => onOpenUrl(event.nativeEvent.targetUrl)}
      onLoadEnd={() => {
        audioExternalRef.current = null
        void pushAudioRoute()
      }}
      onRenderProcessGone={() => recover('a renderer restart')}
      onContentProcessDidTerminate={() => recover('a renderer restart')}
      onError={(event) => {
        recover(`a load failure (${event.nativeEvent.description})`)
      }}
    />
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      onRequestClose={() => finishScan(null)}
      visible={scanRequestId !== null}
    >
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
          <Text style={styles.scanHint}>Align the QR code inside the frame</Text>
          <Pressable
            accessibilityRole='button'
            onPress={() => finishScan(null)}
            style={styles.scannerClose}
          >
            <Text style={styles.scannerCloseText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
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
