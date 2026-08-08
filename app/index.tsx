import { type ComponentRef, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Button,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  Text,
  TextInput,
  useColorScheme,
  View
} from 'react-native'
import { Worklet } from 'react-native-bare-kit'
import { File, Paths } from 'expo-file-system'
import { SafeAreaView } from 'react-native-safe-area-context'
import b4a from 'b4a'
import RPC from 'bare-rpc'
import { WebView } from 'react-native-webview'
import bundle from './app.bundle.mjs'
import {
  BROWSER_HOME_URL,
  commitBrowserEntryState,
  getBrowserBackState,
  getBrowserForwardState,
  getBrowserRequestAction,
  getBrowserWebViewKey,
  isHyperUrl,
  isStaleBrowserLoad,
  isWebUrl,
  MAX_BROWSER_URL_LENGTH,
  normalizeBrowserAddress,
  recordBrowserWebNavigationState,
  replaceBrowserEntryState
} from './browser-shell.mjs'
import {
  addBrowserTabState,
  BROWSER_PAGE_ZOOMS,
  closeBrowserTabState,
  createBrowserTabsState,
  DEFAULT_BROWSER_PAGE_ZOOM,
  isCurrentBrowserTabEntry,
  MAX_BROWSER_TABS,
  normalizeBrowserPageZoom,
  normalizeBrowserTabTitle,
  setBrowserTabViewModeState,
  serializeBrowserTabsState,
  suspendInactiveBrowserTabsState,
  switchBrowserTabState,
  touchLiveBrowserTabIds,
  updateBrowserTabState
} from './browser-tabs.mjs'
import {
  createBrowserResetSession,
  resolveBrowserStartupSession
} from './browser-session.mjs'
import {
  getBrowserPalette,
  resolveBrowserDarkMode
} from './browser-appearance.mjs'
import { createBrowserAccessibilityScript } from './browser-accessibility.mjs'
import {
  canPromptExternalLink,
  formatExternalLinkForPrompt,
  getExternalAppName,
  getExternalLinkBehaviorAction,
  parseExternalAppLink
} from './browser-permissions.mjs'
import {
  INTERNAL_APPS,
  type RuntimeTab,
  getRuntimeAppFromUrl,
  getRuntimeAppTitle,
  getRuntimeAppUrl
} from './internal-apps'
import { SettingsScreen } from './settings/SettingsScreen'
import { BrowserOverflowMenu } from './settings/BrowserOverflowMenu'
import { useBrowserPreferences } from './settings/useBrowserPreferences'
import { BrowserToolbar } from './BrowserToolbar'
import { BrowserZoomSheet } from './BrowserZoomSheet'
import { BookmarksScreen } from './bookmarks/BookmarksScreen'
import { canBookmarkBrowserPage } from './bookmarks/browser-bookmarks.mjs'
import {
  combineBrowserInjectedScripts,
  createBrowserFaviconScript,
  parseBrowserFaviconMessage
} from './bookmarks/browser-favicon.mjs'
import { useBrowserBookmarks } from './bookmarks/useBrowserBookmarks'
import { HistoryScreen } from './history/HistoryScreen'
import { getBrowserHistoryDocumentTitle } from './history/browser-history.mjs'
import { useBrowserHistory } from './history/useBrowserHistory'
import { DownloadsScreen } from './downloads/DownloadsScreen'
import { peerSkyWebViewNativeConfig } from './downloads/PeerSkyWebView'
import { useBrowserDownloads } from './downloads/useBrowserDownloads'
import { BrowserTabsScreen } from './tabs/BrowserTabsScreen'
import { useBrowserTabPreviews } from './tabs/useBrowserTabPreviews'
import { isBrowserTabPreviewForPage } from './tabs/browser-tab-preview.mjs'
import { styles } from './styles'
import {
  RPC_HOLESAIL_CONNECT,
  RPC_HOLESAIL_START_LIVE,
  RPC_HOLESAIL_STATUS,
  RPC_HOLESAIL_STOP,
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT,
  RPC_P2PMD_ROOM_CREATE,
  RPC_P2PMD_ROOM_DISCONNECT,
  RPC_P2PMD_EDITOR_PAGE,
  RPC_P2PMD_IMAGE_UPLOAD,
  RPC_P2PMD_PREVIEW,
  RPC_P2PMD_ROOM_JOIN,
  RPC_P2PMD_ROOM_PUBLISH,
  RPC_P2PMD_ROOM_STATUS
} from '../backend/rpc/commands.mjs'

type P2pmdRoom = {
  key: string
  role: 'host' | 'client'
  localUrl: string
  host: string
  port: number
  secure: boolean
  udp: boolean
}

type RpcResponse = {
  ok: boolean
  error?: string
  status?: number
  statusText?: string
  url?: string
  body?: string
  html?: string
  storagePath?: string
  headers?: Record<string, string>
  running?: boolean
  host?: string
  port?: number
  localUrl?: string
  room?: P2pmdRoom | null
  warning?: string | null
}

type BrowserSource =
  | { kind: 'home' }
  | { kind: 'app', app: RuntimeTab }
  | { kind: 'web', uri: string }
  | { kind: 'hyper', html: string, baseUrl: string }
  | { kind: 'error', html: string }
  | { kind: 'restore', url: string }

type BrowserHistoryEntry = {
  url: string
  source: BrowserSource
}

type BrowserTab = {
  id: string
  title: string
  desktopView: boolean
  history: BrowserHistoryEntry[]
  historyIndex: number
  pageZoom: number
  webCanGoBack: boolean
  webCanGoForward: boolean
}

type BrowserTabsState = {
  tabs: BrowserTab[]
  activeTabId: string
  nextTabIndex: number
  viewMode: 'grid' | 'list'
}

const DESKTOP_BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 PeerSkyMobile/1.0'

export default function App () {
  const systemColorScheme = useColorScheme()
  const workletRef = useRef<Worklet | null>(null)
  const rpcRef = useRef<RPC | null>(null)
  const browserWebViewRefs = useRef(new Map<string, ComponentRef<typeof WebView>>())
  const browserFaviconsRef = useRef(new Map<string, string>())
  const p2pmdWebViewRef = useRef<ComponentRef<typeof WebView> | null>(null)
  const p2pmdPublishInFlightRef = useRef(false)
  const browserLoadSeqRef = useRef(0)
  const browserWebNavigationDirectionsRef = useRef(new Map<string, 'back' | 'forward'>())
  const externalLinkPromptOpenRef = useRef(false)
  const lastExternalLinkPromptAtRef = useRef(0)
  const [isBooting, setIsBooting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('Starting Hyper runtime...')
  const [browserAddress, setBrowserAddress] = useState('')
  const [browserCurrentUrl, setBrowserCurrentUrl] = useState(BROWSER_HOME_URL)
  const [browserTitle, setBrowserTitle] = useState('PeerSky')
  const [browserFavicon, setBrowserFavicon] = useState<string | null>(null)
  const [browserSource, setBrowserSource] = useState<BrowserSource>({ kind: 'home' })
  const [browserHistory, setBrowserHistory] = useState<BrowserHistoryEntry[]>([
    { url: BROWSER_HOME_URL, source: { kind: 'home' } }
  ])
  const [browserHistoryIndex, setBrowserHistoryIndex] = useState(0)
  const [browserTabsState, setBrowserTabsState] = useState<BrowserTabsState>(
    () => createBrowserTabsState() as BrowserTabsState
  )
  const {
    isReady: browserPreferencesReady,
    persistenceError: browserPreferencesError,
    preferences: browserPreferences,
    setAddressBarPosition,
    setCustomSearchEngine,
    setEnforceManualPageZoom,
    setExternalLinkBehavior,
    setRestoreTabsOnStartup,
    setSearchEngine,
    setShowFullAddress,
    setTheme,
    setWebsiteTextScale
  } = useBrowserPreferences()
  const {
    bookmarks: browserBookmarks,
    isReady: browserBookmarksReady,
    isBookmarked: isBrowserPageBookmarked,
    persistenceError: browserBookmarksError,
    removeBookmark: removeBrowserBookmark,
    toggleBookmark: toggleBrowserBookmark
  } = useBrowserBookmarks()
  const {
    clearHistory: clearBrowserHistory,
    getSuggestions: getBrowserHistorySuggestions,
    isReady: browserHistoryReady,
    items: browserVisitHistory,
    persistenceError: browserHistoryError,
    recordVisit: recordBrowserVisit,
    removeHistoryItem: removeBrowserHistoryItem
  } = useBrowserHistory()
  const [browserDownloadsVisible, setBrowserDownloadsVisible] = useState(false)
  const {
    downloads: browserDownloads,
    error: browserDownloadsError,
    isReady: browserDownloadsReady,
    openDownload: openBrowserDownload,
    refresh: refreshBrowserDownloads,
    removeDownload: removeBrowserDownload,
    requestDownload: requestBrowserDownload
  } = useBrowserDownloads({ enabled: browserDownloadsVisible })
  const browserTabsStateRef = useRef(browserTabsState)
  const browserSessionReadyRef = useRef(false)
  const browserSessionRestoreStartedRef = useRef(false)
  const browserUserInteractedRef = useRef(false)
  const [browserLiveTabIds, setBrowserLiveTabIds] = useState(['tab-1'])
  const [browserSessionReady, setBrowserSessionReady] = useState(false)
  const [browserTabsVisible, setBrowserTabsVisible] = useState(false)
  const [browserMenuVisible, setBrowserMenuVisible] = useState(false)
  const [browserZoomVisible, setBrowserZoomVisible] = useState(false)
  const [browserSettingsVisible, setBrowserSettingsVisible] = useState(false)
  const [browserBookmarksVisible, setBrowserBookmarksVisible] = useState(false)
  const [browserHistoryVisible, setBrowserHistoryVisible] = useState(false)
  const [pendingRestoredUrl, setPendingRestoredUrl] = useState<string | null>(null)
  const [browserCanGoBack, setBrowserCanGoBack] = useState(false)
  const [browserCanGoForward, setBrowserCanGoForward] = useState(false)
  const [browserWebCanGoBack, setBrowserWebCanGoBack] = useState(false)
  const [browserWebCanGoForward, setBrowserWebCanGoForward] = useState(false)
  const [browserIsLoading, setBrowserIsLoading] = useState(false)
  const [url, setUrl] = useState('hyper://localhost/')
  const [activeTab, setActiveTab] = useState<RuntimeTab>('hyper')
  const [lastResult, setLastResult] = useState<RpcResponse | null>(null)
  const [hsLivePort, setHsLivePort] = useState('8989')
  const [hsLiveHost, setHsLiveHost] = useState('127.0.0.1')
  const [hsConnector, setHsConnector] = useState('')
  const [hsConnectKey, setHsConnectKey] = useState('')
  const [hsConnectPort, setHsConnectPort] = useState('8989')
  const [hsConnectHost, setHsConnectHost] = useState('127.0.0.1')
  const [p2pmdUrl, setP2pmdUrl] = useState<string | null>(null)
  const [p2pmdRoom, setP2pmdRoom] = useState<P2pmdRoom | null>(null)
  const [p2pmdEditorHtml, setP2pmdEditorHtml] = useState<string | null>(null)
  const [p2pmdJoinKey, setP2pmdJoinKey] = useState('')
  const [p2pmdParticipants, setP2pmdParticipants] = useState<number | null>(null)
  const [p2pmdIsPreviewMode, setP2pmdIsPreviewMode] = useState(false)
  const [p2pmdSyncStatus, setP2pmdSyncStatus] = useState('Ready')
  const [p2pmdSetupError, setP2pmdSetupError] = useState<string | null>(null)
  const [p2pmdPublishUrl, setP2pmdPublishUrl] = useState<string | null>(null)
  const [isP2pmdPublishing, setIsP2pmdPublishing] = useState(false)
  const shouldShowRuntimeStatus = activeTab !== 'p2pmd'
  const {
    clearAllPreviews: clearAllBrowserTabPreviews,
    clearCachedPreviews: clearCachedBrowserTabPreviews,
    clearPreview: clearBrowserTabPreview,
    previews: browserTabPreviews,
    removePreview: removeBrowserTabPreview,
    restorePreviews: restoreBrowserTabPreviews,
    schedulePreview: scheduleBrowserTabPreview,
    setCaptureLayout: setBrowserPreviewLayout,
    setCaptureView: setBrowserPreviewView
  } = useBrowserTabPreviews<BrowserHistoryEntry>({
    getEntryKey: (entry) => entry.url,
    isCurrentEntry: (tabId, entry) => {
      const tab = browserTabsStateRef.current.tabs.find((item) => item.id === tabId)
      const currentEntry = tab?.history[tab.historyIndex]
      return Boolean(
        currentEntry &&
        currentEntry.source.kind === entry.source.kind &&
        isBrowserTabPreviewForPage(currentEntry.url, entry.url)
      )
    }
  })

  useEffect(() => {
    void startWorklet()
    return () => {
      workletRef.current?.terminate()
      workletRef.current = null
      rpcRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!browserPreferencesReady || browserSessionRestoreStartedRef.current) return
    browserSessionRestoreStartedRef.current = true
    let cancelled = false

    async function restoreBrowserSession () {
      try {
        const sessionFile = getBrowserSessionFile()
        const serializedSession = sessionFile.exists ? await sessionFile.text() : null
        if (cancelled) return

        const restored = resolveBrowserStartupSession({
          restoreTabsOnStartup: browserPreferences.restoreTabsOnStartup,
          serializedSession,
          userInteracted: browserUserInteractedRef.current
        }) as BrowserTabsState | null
        if (!restored) return

        const tab = restored.tabs.find((item) => item.id === restored.activeTabId)
        updateBrowserTabsState(restored)
        if (tab) applyBrowserTab(tab)
      } catch (error) {
        console.error('Failed restoring browser tabs:', error)
      } finally {
        if (!cancelled) {
          browserSessionReadyRef.current = true
          setBrowserSessionReady(true)
        }
      }
    }

    void restoreBrowserSession()

    return () => {
      cancelled = true
    }
  }, [browserPreferencesReady])

  useEffect(() => {
    if (!browserSessionReady) return

    const timer = setTimeout(() => writeBrowserSession(browserTabsState), 200)
    return () => clearTimeout(timer)
  }, [browserSessionReady, browserTabsState])

  useEffect(() => {
    if (!browserSessionReady) return

    restoreBrowserTabPreviews(browserTabsStateRef.current.tabs.flatMap((tab) => {
      const entry = tab.history[tab.historyIndex]
      return entry ? [{ entry, tabId: tab.id }] : []
    }))
  }, [browserSessionReady])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && browserSessionReadyRef.current) {
        writeBrowserSession(browserTabsStateRef.current)
      }
    })

    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!isBrowserWebViewSource(browserSource)) return

    setBrowserLiveTabIds((tabIds) => touchLiveBrowserTabIds(
      tabIds,
      browserTabsState.activeTabId
    ))
  }, [browserSource.kind, browserTabsState.activeTabId])

  useEffect(() => {
    updateBrowserTabsState((state) => suspendInactiveBrowserTabsState(
      state,
      browserLiveTabIds
    ) as BrowserTabsState)
  }, [browserLiveTabIds])

  useEffect(() => {
    if (!pendingRestoredUrl) return
    if (isHyperUrl(pendingRestoredUrl) && (isBooting || !rpcRef.current)) return

    const restoredUrl = pendingRestoredUrl
    setPendingRestoredUrl(null)
    void loadRestoredBrowserUrl(restoredUrl)
  }, [isBooting, pendingRestoredUrl])

  function updateBrowserTabsState (
    update: BrowserTabsState | ((state: BrowserTabsState) => BrowserTabsState)
  ) {
    if (typeof update !== 'function') {
      browserTabsStateRef.current = update
      setBrowserTabsState(update)
      return
    }

    setBrowserTabsState((state) => {
      const nextState = update(state)
      browserTabsStateRef.current = nextState
      return nextState
    })
  }

  async function startWorklet () {
    if (workletRef.current) return

    setIsBooting(true)
    setStatus('Starting Bare worklet...')

    try {
      const storageDir = Paths.document?.uri
        ? `${toBareFsPath(Paths.document.uri)}/hyper-storage`
        : 'hyper-storage'

      const worklet = new Worklet()
      worklet.start('/app.bundle', bundle, [storageDir])

      const rpc = new RPC(worklet.IPC, () => {})

      workletRef.current = worklet
      rpcRef.current = rpc

      const initResponse = await callRpc(RPC_HYPER_INIT, {})

      if (!initResponse.ok) {
        throw new Error(initResponse.error || 'Unable to initialize Hyper')
      }

      setStatus(`Hyper ready (${initResponse.storagePath || storageDir})`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBooting(false)
    }
  }

  async function callRpc (command: number, payload: object) {
    const rpc = rpcRef.current

    if (!rpc) {
      throw new Error('Worklet is not ready')
    }

    const request = rpc.request(command)
    request.send(JSON.stringify(payload))

    const reply = await request.reply()
    if (!reply) return { ok: false, error: 'Missing response' }

    if (typeof reply === 'string') {
      return JSON.parse(reply)
    }

    return JSON.parse(b4a.toString(reply as Uint8Array))
  }

  async function onFetch () {
    setIsLoading(true)
    setStatus('Fetching from Hyper...')
    setLastResult(null)

    try {
      const response = await callRpc(RPC_HYPER_FETCH, {
        url: url.trim(),
        method: 'GET'
      })

      setLastResult(response)

      if (!response.ok) {
        setStatus(response.error || 'Hyper fetch failed')
      } else {
        setStatus(`Fetch complete (${response.status} ${response.statusText})`)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function onCreateDrive () {
    setIsLoading(true)
    setStatus('Creating writable Hyperdrive...')
    setLastResult(null)

    try {
      const response = await callRpc(RPC_HYPER_CREATE_DRIVE, {})
      setLastResult(response)

      if (!response.ok) {
        setStatus(response.error || 'Failed creating Hyperdrive')
        return
      }

      if (response.url) {
        setUrl(response.url)
      }
      setStatus(`Drive created (${response.status} ${response.statusText})`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  function commitBrowserEntry (url: string, source: BrowserSource) {
    applyBrowserState(commitBrowserEntryState(getBrowserState(), url, source))
  }

  function replaceBrowserEntry (url: string, source: BrowserSource) {
    applyBrowserState(replaceBrowserEntryState(getBrowserState(), url, source))
  }

  function syncBrowserEntry (
    url: string,
    source: BrowserSource,
    webNavigation?: { canGoBack: boolean, canGoForward: boolean },
    tabId?: string
  ) {
    const targetTabId = tabId || browserTabsStateRef.current.activeTabId
    const direction = browserWebNavigationDirectionsRef.current.get(targetTabId)
    browserWebNavigationDirectionsRef.current.delete(targetTabId)
    const targetTab = browserTabsStateRef.current.tabs.find((tab) => tab.id === targetTabId)
    const nextState = recordBrowserWebNavigationState(
      targetTab
        ? { history: targetTab.history, historyIndex: targetTab.historyIndex }
        : getBrowserState(),
      url,
      source,
      direction
    )
    applyBrowserState({
      ...nextState,
      webCanGoBack: webNavigation?.canGoBack,
      webCanGoForward: webNavigation?.canGoForward
    }, targetTabId)
  }

  function getBrowserState () {
    return {
      history: browserHistory,
      historyIndex: browserHistoryIndex
    }
  }

  function applyBrowserState (nextState: {
    history: BrowserHistoryEntry[]
    historyIndex: number
    currentUrl: string
    address: string
    source: BrowserSource
    canGoBack: boolean
    canGoForward: boolean
    webCanGoBack?: boolean
    webCanGoForward?: boolean
  }, tabId = browserTabsStateRef.current.activeTabId) {
    setBrowserHistory(nextState.history)
    setBrowserHistoryIndex(nextState.historyIndex)
    setBrowserCurrentUrl(nextState.currentUrl)
    setBrowserAddress(nextState.address)
    setBrowserSource(nextState.source)
    setBrowserCanGoBack(nextState.canGoBack)
    setBrowserCanGoForward(nextState.canGoForward)
    if (
      nextState.source.kind !== 'web' &&
      nextState.source.kind !== 'hyper'
    ) {
      browserFaviconsRef.current.delete(tabId)
      if (browserTabsStateRef.current.activeTabId === tabId) {
        setBrowserFavicon(null)
      }
    }
    setPendingRestoredUrl(
      nextState.source.kind === 'restore' ? nextState.currentUrl : null
    )
    updateBrowserTabsState((state) => {
      const activeTab = state.tabs.find((tab) => tab.id === tabId)
      return updateBrowserTabState(state, tabId, {
        title: getBrowserEntryTitle({
          url: nextState.currentUrl,
          source: nextState.source
        }),
        history: nextState.history,
        historyIndex: nextState.historyIndex,
        webCanGoBack: typeof nextState.webCanGoBack === 'boolean'
          ? nextState.webCanGoBack
          : activeTab?.webCanGoBack || false,
        webCanGoForward: typeof nextState.webCanGoForward === 'boolean'
          ? nextState.webCanGoForward
          : activeTab?.webCanGoForward || false
      }) as BrowserTabsState
    })

    if (typeof nextState.webCanGoBack === 'boolean') {
      setBrowserWebCanGoBack(nextState.webCanGoBack)
    }

    if (typeof nextState.webCanGoForward === 'boolean') {
      setBrowserWebCanGoForward(nextState.webCanGoForward)
    }
  }

  function updateBrowserTabTitle (tabId: string, title: string) {
    updateBrowserTabsState((state) => updateBrowserTabState(
      state,
      tabId,
      { title: normalizeBrowserTabTitle(title) }
    ) as BrowserTabsState)
  }

  function syncBackgroundBrowserTab (
    tabId: string,
    expectedEntry: BrowserHistoryEntry,
    navigationState: {
      url: string
      title?: string
      canGoBack: boolean
      canGoForward: boolean
    }
  ) {
    if (!isWebUrl(navigationState.url) || navigationState.url.length > MAX_BROWSER_URL_LENGTH) return

    updateBrowserTabsState((state) => {
      const tab = state.tabs.find((item) => item.id === tabId)
      if (!tab || !isCurrentBrowserTabEntry(state, tabId, expectedEntry)) return state

      const nextState = recordBrowserWebNavigationState(
        { history: tab.history, historyIndex: tab.historyIndex },
        navigationState.url,
        { kind: 'web', uri: navigationState.url }
      )

      return updateBrowserTabState(state, tabId, {
        title: navigationState.title || navigationState.url,
        history: nextState.history,
        historyIndex: nextState.historyIndex,
        webCanGoBack: navigationState.canGoBack,
        webCanGoForward: navigationState.canGoForward
      }) as BrowserTabsState
    })
  }

  function updateBackgroundBrowserEntry (
    tabId: string,
    expectedEntry: BrowserHistoryEntry,
    url: string,
    source: BrowserSource,
    replace = false
  ) {
    updateBrowserTabsState((state) => {
      const tab = state.tabs.find((item) => item.id === tabId)
      const entryMatches = replace
        ? isCurrentBrowserTabEntry(state, tabId, expectedEntry)
        : tab?.history[tab.historyIndex] === expectedEntry
      if (!tab || !entryMatches) return state

      const nextState = (replace ? replaceBrowserEntryState : commitBrowserEntryState)(
        { history: tab.history, historyIndex: tab.historyIndex },
        url,
        source
      )

      return updateBrowserTabState(state, tabId, {
        title: getBrowserEntryTitle({ url, source }),
        history: nextState.history,
        historyIndex: nextState.historyIndex,
        webCanGoBack: false,
        webCanGoForward: false
      }) as BrowserTabsState
    })
  }

  function cancelPendingBrowserLoad () {
    browserLoadSeqRef.current += 1
    setBrowserIsLoading(false)
  }

  async function onBrowserSubmit () {
    await loadBrowserUrl(browserAddress)
  }

  async function loadBrowserUrl (rawUrl: string) {
    browserUserInteractedRef.current = true
    const nextUrl = normalizeBrowserAddress(
      rawUrl,
      browserPreferences.searchEngine,
      browserPreferences.customSearchUrl
    )

    if (nextUrl.length > MAX_BROWSER_URL_LENGTH) {
      cancelPendingBrowserLoad()
      showBrowserError(BROWSER_HOME_URL, 'URL is too long')
      return
    }

    if (nextUrl === BROWSER_HOME_URL) {
      cancelPendingBrowserLoad()
      openBrowserHome()
      return
    }

    const internalApp = getRuntimeAppFromUrl(nextUrl)
    if (internalApp) {
      openInternalApp(internalApp)
      return
    }

    const externalLink = parseExternalAppLink(nextUrl)
    if (externalLink) {
      openExternalAppLink(externalLink.url)
      return
    }

    if (isHyperUrl(nextUrl)) {
      await loadHyperBrowserUrl(nextUrl)
      return
    }

    if (isWebUrl(nextUrl)) {
      cancelPendingBrowserLoad()
      commitBrowserEntry(nextUrl, {
        kind: 'web',
        uri: nextUrl
      })
      setBrowserTitle(nextUrl)
      return
    }

    cancelPendingBrowserLoad()
    showBrowserError(nextUrl, 'Unsupported URL scheme')
  }

  async function loadRestoredBrowserUrl (url: string) {
    const internalApp = getRuntimeAppFromUrl(url)

    if (url === BROWSER_HOME_URL) {
      replaceBrowserEntry(BROWSER_HOME_URL, { kind: 'home' })
      setBrowserTitle('PeerSky')
      return
    }

    if (internalApp) {
      openInternalApp(internalApp, false)
      return
    }

    if (isHyperUrl(url)) {
      await loadHyperBrowserUrl(url, false)
      return
    }

    if (isWebUrl(url)) {
      replaceBrowserEntry(url, { kind: 'web', uri: url })
      setBrowserTitle(url)
      return
    }

    showBrowserError(url, 'Unsupported restored URL scheme')
  }

  async function loadHyperBrowserUrl (nextUrl: string, shouldCommit = true) {
    const loadSeq = ++browserLoadSeqRef.current
    setBrowserIsLoading(true)
    setBrowserTitle('Loading Hyper...')
    setStatus(`Loading ${nextUrl}`)

    try {
      const response = await callRpc(RPC_HYPER_FETCH, {
        url: nextUrl,
        method: 'GET',
        inlineAssets: true
      })

      if (isStaleBrowserLoad(loadSeq, browserLoadSeqRef.current)) return

      if (!response.ok) {
        throw new Error(response.error || response.statusText || 'Unable to load Hyper page')
      }

      const responseUrl = response.url &&
        response.url.length <= MAX_BROWSER_URL_LENGTH &&
        isHyperUrl(response.url)
        ? response.url
        : nextUrl

      const source: BrowserSource = {
        kind: 'hyper',
        html: createHyperBrowserHtml(response, nextUrl),
        baseUrl: nextUrl
      }

      if (shouldCommit) {
        commitBrowserEntry(responseUrl, source)
      } else {
        replaceBrowserEntry(responseUrl, source)
      }

      const pageTitle = getBrowserHistoryDocumentTitle(response.body, responseUrl)
      setBrowserTitle(pageTitle)
      updateBrowserTabTitle(browserTabsStateRef.current.activeTabId, pageTitle)
      recordBrowserVisit({ url: responseUrl, title: pageTitle })
      setStatus(`Loaded ${response.status || 200} ${response.statusText || 'OK'}`)
    } catch (error) {
      if (isStaleBrowserLoad(loadSeq, browserLoadSeqRef.current)) return

      const message = error instanceof Error ? error.message : String(error)
      const source: BrowserSource = {
        kind: 'error',
        html: createBrowserErrorHtml(nextUrl, message)
      }

      if (shouldCommit) {
        commitBrowserEntry(nextUrl, source)
      } else {
        replaceBrowserEntry(nextUrl, source)
      }

      setBrowserTitle('Page failed')
      setStatus(message)
    } finally {
      if (loadSeq === browserLoadSeqRef.current) {
        setBrowserIsLoading(false)
      }
    }
  }

  function openBrowserHome () {
    commitBrowserEntry(BROWSER_HOME_URL, { kind: 'home' })
    setBrowserTitle('PeerSky')
    setStatus('Browser home')
  }

  function openInternalApp (app: RuntimeTab, shouldCommit = true) {
    const appUrl = getRuntimeAppUrl(app)
    cancelPendingBrowserLoad()
    setLastResult(null)
    setActiveTab(app)
    setBrowserTitle(getRuntimeAppTitle(app))
    setStatus(`${getRuntimeAppTitle(app)} opened`)

    if (shouldCommit) {
      commitBrowserEntry(appUrl, { kind: 'app', app })
    } else {
      replaceBrowserEntry(appUrl, { kind: 'app', app })
    }
  }

  function showBrowserError (targetUrl: string, message: string) {
    const source: BrowserSource = {
      kind: 'error',
      html: createBrowserErrorHtml(targetUrl, message)
    }

    commitBrowserEntry(targetUrl, source)
    setBrowserTitle('Page failed')
    setStatus(message)
  }

  function onBrowserBack () {
    browserUserInteractedRef.current = true
    cancelPendingBrowserLoad()

    if (browserSource.kind === 'web' && browserWebCanGoBack) {
      browserWebNavigationDirectionsRef.current.set(browserTabsState.activeTabId, 'back')
      browserWebViewRefs.current.get(browserTabsState.activeTabId)?.goBack()
      return
    }

    const nextState = getBrowserBackState(getBrowserState())
    if (!nextState) return

    const entry = nextState.history[nextState.historyIndex]
    applyBrowserState(nextState)
    setBrowserTitle(getBrowserEntryTitle(entry))
    setActiveTab(entry.source.kind === 'app' ? entry.source.app : 'hyper')
  }

  function onBrowserForward () {
    browserUserInteractedRef.current = true
    cancelPendingBrowserLoad()

    if (browserSource.kind === 'web' && browserWebCanGoForward) {
      browserWebNavigationDirectionsRef.current.set(browserTabsState.activeTabId, 'forward')
      browserWebViewRefs.current.get(browserTabsState.activeTabId)?.goForward()
      return
    }

    const nextState = getBrowserForwardState(getBrowserState())
    if (!nextState) return

    const entry = nextState.history[nextState.historyIndex]
    applyBrowserState(nextState)
    setBrowserTitle(getBrowserEntryTitle(entry))
    setActiveTab(entry.source.kind === 'app' ? entry.source.app : 'hyper')
  }

  function onBrowserReload () {
    browserUserInteractedRef.current = true
    if (browserIsLoading && browserSource.kind === 'web') {
      cancelPendingBrowserLoad()
      browserWebViewRefs.current.get(browserTabsState.activeTabId)?.stopLoading()
      return
    }

    if (browserSource.kind === 'web') {
      cancelPendingBrowserLoad()
      browserWebViewRefs.current.get(browserTabsState.activeTabId)?.reload()
      return
    }

    if (browserSource.kind === 'hyper') {
      void loadHyperBrowserUrl(browserCurrentUrl, false)
      return
    }

    if (browserSource.kind === 'app') {
      openInternalApp(browserSource.app, false)
    }
  }

  function applyBrowserTab (tab: BrowserTab) {
    const entry = tab.history[tab.historyIndex]
    if (!entry) return

    setBrowserHistory(tab.history)
    setBrowserHistoryIndex(tab.historyIndex)
    setBrowserCurrentUrl(entry.url)
    setBrowserAddress(entry.url === BROWSER_HOME_URL ? '' : entry.url)
    setBrowserSource(entry.source)
    setBrowserCanGoBack(tab.historyIndex > 0)
    setBrowserCanGoForward(tab.history.length > tab.historyIndex + 1)
    setBrowserWebCanGoBack(tab.webCanGoBack)
    setBrowserWebCanGoForward(tab.webCanGoForward)
    setBrowserTitle(normalizeBrowserTabTitle(tab.title || getBrowserEntryTitle(entry)))
    setBrowserFavicon(
      entry.source.kind === 'web' || entry.source.kind === 'hyper'
        ? browserFaviconsRef.current.get(tab.id) || null
        : null
    )

    if (entry.source.kind === 'app') {
      setActiveTab(entry.source.app)
    } else {
      setActiveTab('hyper')
    }

    setPendingRestoredUrl(
      entry.source.kind === 'restore' ? entry.url : null
    )
  }

  function onBrowserNewTab () {
    if (browserTabsStateRef.current.tabs.length >= MAX_BROWSER_TABS) {
      setStatus('Maximum number of tabs reached')
      return
    }

    browserUserInteractedRef.current = true
    cancelPendingBrowserLoad()
    const nextState = addBrowserTabState(browserTabsStateRef.current) as BrowserTabsState
    const tab = nextState.tabs.find((item) => item.id === nextState.activeTabId)

    updateBrowserTabsState(nextState)
    if (tab) applyBrowserTab(tab)
    setBrowserTabsVisible(false)
    setBrowserMenuVisible(false)
    setBrowserTitle('PeerSky')
    setStatus('New tab')
  }

  function onBrowserToggleBookmark () {
    const result = toggleBrowserBookmark({
      url: browserCurrentUrl,
      title: browserTitle,
      favicon: browserFavicon
    })

    if (result === 'limit-reached') {
      const message = 'Delete a bookmark before adding another.'
      setStatus(`Maximum of 200 bookmarks reached. ${message}`)
      Alert.alert('Bookmark limit reached', message)
    } else if (result) {
      setStatus(result === 'added' ? 'Bookmark added' : 'Bookmark removed')
    } else {
      setStatus('Unable to update bookmark')
    }
  }

  async function onBrowserSharePage () {
    if (!browserBookmarkActionAvailable) return

    try {
      await Share.share({
        title: browserTitle,
        message: browserCurrentUrl,
        url: browserCurrentUrl
      })
      setStatus('Page shared')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  function updateActiveBrowserZoom (nextZoom: number) {
    const activeTabId = browserTabsStateRef.current.activeTabId
    const zoom = normalizeBrowserPageZoom(nextZoom)

    updateBrowserTabsState((state) => updateBrowserTabState(
      state,
      activeTabId,
      { pageZoom: zoom }
    ) as BrowserTabsState)
    browserWebViewRefs.current.get(activeTabId)?.injectJavaScript(createBrowserAccessibilityScript({
      applyTextScale: Platform.OS === 'ios',
      enforceManualPageZoom: browserPreferences.enforceManualPageZoom,
      pageZoom: zoom,
      websiteTextScale: browserPreferences.websiteTextScale
    }))
    setStatus(`Zoom set to ${zoom}%`)
  }

  function onBrowserZoomIn () {
    const currentIndex = BROWSER_PAGE_ZOOMS.indexOf(activeBrowserPageZoom)
    if (currentIndex < 0 || currentIndex >= BROWSER_PAGE_ZOOMS.length - 1) return
    updateActiveBrowserZoom(BROWSER_PAGE_ZOOMS[currentIndex + 1])
  }

  function onBrowserZoomOut () {
    const currentIndex = BROWSER_PAGE_ZOOMS.indexOf(activeBrowserPageZoom)
    if (currentIndex <= 0) return
    updateActiveBrowserZoom(BROWSER_PAGE_ZOOMS[currentIndex - 1])
  }

  function onBrowserResetZoom () {
    updateActiveBrowserZoom(DEFAULT_BROWSER_PAGE_ZOOM)
  }

  function onBrowserToggleDesktopView () {
    const activeTabId = browserTabsStateRef.current.activeTabId
    const activeTab = browserTabsStateRef.current.tabs.find((tab) => tab.id === activeTabId)
    const nextDesktopView = activeTab?.desktopView !== true

    browserWebViewRefs.current.get(activeTabId)?.injectJavaScript(
      createBrowserAccessibilityScript({
        applyTextScale: Platform.OS === 'ios',
        desktopView: nextDesktopView,
        enforceManualPageZoom: browserPreferences.enforceManualPageZoom,
        pageZoom: normalizeBrowserPageZoom(activeTab?.pageZoom),
        websiteTextScale: browserPreferences.websiteTextScale
      })
    )
    updateBrowserTabsState((state) => updateBrowserTabState(
      state,
      activeTabId,
      { desktopView: nextDesktopView }
    ) as BrowserTabsState)

    setStatus(nextDesktopView ? 'Desktop View enabled' : 'Desktop View disabled')
  }

  function onBrowserOpenBookmarks () {
    setBrowserMenuVisible(false)
    setBrowserBookmarksVisible(true)
  }

  function onBrowserOpenDownloads () {
    setBrowserMenuVisible(false)
    setBrowserDownloadsVisible(true)
  }

  function onBrowserOpenHistory () {
    setBrowserMenuVisible(false)
    setBrowserHistoryVisible(true)
  }

  function onBrowserSwitchTab (tabId: string) {
    if (tabId === browserTabsStateRef.current.activeTabId) {
      setBrowserTabsVisible(false)
      return
    }

    browserUserInteractedRef.current = true
    cancelPendingBrowserLoad()
    const nextState = switchBrowserTabState(browserTabsStateRef.current, tabId) as BrowserTabsState
    const tab = nextState.tabs.find((item) => item.id === nextState.activeTabId)

    updateBrowserTabsState(nextState)
    if (tab) applyBrowserTab(tab)
    setBrowserTabsVisible(false)
    if (tab) {
      const entry = tab.history[tab.historyIndex]
      if (entry && isBrowserWebViewSource(entry.source)) {
        scheduleBrowserTabPreview(tab.id, entry, 400)
      }
    }
    setStatus('Tab switched')
  }

  function onBrowserCloseTab (tabId: string) {
    browserUserInteractedRef.current = true
    const currentTabsState = browserTabsStateRef.current
    const isClosingActive = tabId === currentTabsState.activeTabId
    if (isClosingActive) cancelPendingBrowserLoad()

    const nextState = closeBrowserTabState(currentTabsState, tabId) as BrowserTabsState
    const tab = nextState.tabs.find((item) => item.id === nextState.activeTabId)

    updateBrowserTabsState(nextState)
    removeBrowserTabPreview(tabId)
    browserFaviconsRef.current.delete(tabId)
    setBrowserLiveTabIds((tabIds) => tabIds.filter((id) => id !== tabId))
    if (isClosingActive && tab) applyBrowserTab(tab)
    setStatus('Tab closed')
  }

  function onBrowserResetTabs (clearPreviews = true) {
    browserUserInteractedRef.current = true
    cancelPendingBrowserLoad()
    const reset = createBrowserResetSession(
      browserWebViewRefs.current,
      browserTabsStateRef.current.viewMode
    ) as {
      tabsState: BrowserTabsState
      liveTabIds: string[]
    }
    const nextState = reset.tabsState
    const tab = nextState.tabs[0]

    updateBrowserTabsState(nextState)
    const previewCacheCleared = clearPreviews
      ? clearAllBrowserTabPreviews()
      : true
    browserFaviconsRef.current.clear()
    setBrowserLiveTabIds(reset.liveTabIds)
    if (tab) applyBrowserTab(tab)
    const sessionSaved = writeBrowserSession(nextState)
    setStatus(
      !sessionSaved
        ? 'Tab session reset, but could not be saved'
        : !previewCacheCleared
          ? 'Tab session reset, but preview cache could not be cleared'
          : 'Tab session reset'
    )
    return { previewCacheCleared, sessionSaved }
  }

  function onBrowserBurnTabs () {
    Alert.alert(
      'Close all tabs?',
      'This closes every open tab and starts a fresh tab.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close all',
          style: 'destructive',
          onPress: () => {
            const { previewCacheCleared, sessionSaved } = onBrowserResetTabs()
            setBrowserTabsVisible(false)
            setBrowserTitle('PeerSky')
            setStatus(
              !sessionSaved
                ? 'All tabs closed, but the fresh session could not be saved'
                : !previewCacheCleared
                  ? 'All tabs closed, but preview cache could not be cleared'
                  : 'All tabs closed'
            )
          }
        }
      ]
    )
  }

  function onBrowserToggleTabView () {
    const nextViewMode = browserTabsStateRef.current.viewMode === 'grid'
      ? 'list'
      : 'grid'
    updateBrowserTabsState((state) =>
      setBrowserTabViewModeState(state, nextViewMode) as BrowserTabsState
    )
    setStatus(`Tab ${nextViewMode} view enabled`)
  }

  function onBrowserShouldStartLoad (
    tabId: string,
    expectedEntry: BrowserHistoryEntry,
    request: { url?: string, isTopFrame?: boolean }
  ) {
    const currentTab = browserTabsStateRef.current.tabs.find((tab) => tab.id === tabId)
    if (!currentTab || currentTab.history[currentTab.historyIndex] !== expectedEntry) return false

    const action = getBrowserRequestAction({
      requestUrl: request.url,
      currentSourceKind: expectedEntry.source.kind,
      isTopFrame: request.isTopFrame !== false
    })
    const isActive = browserTabsStateRef.current.activeTabId === tabId

    if (action.action === 'allow') return true

    if (
      action.action === 'open-external' &&
      action.url &&
      'scheme' in action &&
      action.scheme
    ) {
      if (isActive) openExternalAppLink(action.url)
      return false
    }

    if (action.action === 'load-hyper' && action.url) {
      if (isActive) {
        void loadBrowserUrl(action.url)
      } else {
        updateBackgroundBrowserEntry(tabId, expectedEntry, action.url, {
          kind: 'restore',
          url: action.url
        })
      }
      return false
    }

    if (action.action === 'commit-web' && action.url && action.source) {
      if (isActive) {
        cancelPendingBrowserLoad()
        commitBrowserEntry(action.url, action.source as BrowserSource)
        setBrowserTitle(action.url)
      } else {
        updateBackgroundBrowserEntry(
          tabId,
          expectedEntry,
          action.url,
          action.source as BrowserSource
        )
      }
      return false
    }

    return false
  }

  function onBrowserOpenWindow (
    tabId: string,
    expectedEntry: BrowserHistoryEntry,
    targetUrl: string
  ) {
    const currentTab = browserTabsStateRef.current.tabs.find((tab) => tab.id === tabId)
    if (
      !currentTab ||
      !isCurrentBrowserTabEntry(browserTabsStateRef.current, tabId, expectedEntry) ||
      browserTabsStateRef.current.activeTabId !== tabId
    ) return

    const action = getBrowserRequestAction({
      requestUrl: targetUrl,
      currentSourceKind: expectedEntry.source.kind
    })

    if (action.action === 'open-external' && action.url) {
      openExternalAppLink(action.url)
      return
    }

    if (isWebUrl(targetUrl) || isHyperUrl(targetUrl)) {
      void loadBrowserUrl(targetUrl)
    }
  }

  function openExternalAppLink (targetUrl: string) {
    const externalLink = parseExternalAppLink(targetUrl)
    if (!externalLink) {
      setStatus('Unsupported external app link')
      return
    }

    const behaviorAction = getExternalLinkBehaviorAction(browserPreferences.externalLinkBehavior)
    if (behaviorAction === 'block') {
      setStatus('External app link blocked')
      return
    }

    const now = Date.now()
    if (
      externalLinkPromptOpenRef.current ||
      !canPromptExternalLink(lastExternalLinkPromptAtRef.current, now)
    ) {
      setStatus('External app link temporarily blocked')
      return
    }

    lastExternalLinkPromptAtRef.current = now

    if (behaviorAction === 'open') {
      launchExternalAppLink(externalLink.url)
      return
    }

    externalLinkPromptOpenRef.current = true

    const resetPrompt = () => {
      externalLinkPromptOpenRef.current = false
    }

    Alert.alert(
      'Open another app?',
      `This page wants to open ${getExternalAppName(externalLink.scheme)}:\n\n${formatExternalLinkForPrompt(externalLink.url)}`,
      [
        { text: 'Cancel', style: 'cancel', onPress: resetPrompt },
        {
          text: 'Open',
          onPress: () => launchExternalAppLink(externalLink.url)
        }
      ],
      { cancelable: true, onDismiss: resetPrompt }
    )
  }

  function launchExternalAppLink (targetUrl: string) {
    const externalLink = parseExternalAppLink(targetUrl)
    if (!externalLink) {
      externalLinkPromptOpenRef.current = false
      setStatus('Unsupported external app link')
      return
    }

    externalLinkPromptOpenRef.current = true
    void Linking.openURL(externalLink.url)
      .catch((error) => {
        console.error('Failed opening external app link:', error)
        Alert.alert('Unable to open link', 'No compatible app could open this link.')
      })
      .finally(() => {
        externalLinkPromptOpenRef.current = false
      })
  }


  async function onHolesailStartLive () {
    setIsLoading(true)
    setStatus('Starting Holesail live tunnel...')
    setLastResult(null)

    try {
      const livePortValue = hsLivePort.trim()
      const response = await callRpc(RPC_HOLESAIL_START_LIVE, {
        port: livePortValue === '' ? undefined : Number(livePortValue),
        host: hsLiveHost.trim(),
        connector: hsConnector.trim() || undefined,
        secure: true
      })
      setLastResult(response)

      if (!response.ok) {
        setStatus(response.error || 'Failed starting Holesail live mode')
        return
      }

      setStatus('Holesail live tunnel started')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function onHolesailConnect () {
    setIsLoading(true)
    setStatus('Connecting Holesail client...')
    setLastResult(null)

    try {
      const connectPortValue = hsConnectPort.trim()
      const response = await callRpc(RPC_HOLESAIL_CONNECT, {
        key: hsConnectKey.trim(),
        port: connectPortValue === '' ? undefined : Number(connectPortValue),
        host: hsConnectHost.trim()
      })
      setLastResult(response)

      if (!response.ok) {
        setStatus(response.error || 'Failed connecting Holesail client')
        return
      }

      setStatus('Holesail client connected')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function onHolesailStatus () {
    setIsLoading(true)
    setStatus('Reading Holesail status...')
    setLastResult(null)

    try {
      const response = await callRpc(RPC_HOLESAIL_STATUS, {})
      setLastResult(response)
      setStatus(response.ok ? 'Holesail status loaded' : (response.error || 'Holesail status failed'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function onHolesailStop () {
    setIsLoading(true)
    setStatus('Stopping Holesail session...')
    setLastResult(null)

    try {
      const response = await callRpc(RPC_HOLESAIL_STOP, {})
      setLastResult(response)
      setStatus(response.ok ? 'Holesail stopped' : (response.error || 'Failed stopping Holesail'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function onP2pmdRoomCreate () {
    setIsLoading(true)
    setStatus('Creating P2PMD room...')
    setLastResult(null)
    setP2pmdRoom(null)
    setP2pmdUrl(null)
    setP2pmdParticipants(null)
    setP2pmdIsPreviewMode(false)
    setP2pmdPublishUrl(null)
    setP2pmdEditorHtml(null)
    setP2pmdSetupError(null)
    setP2pmdSyncStatus('Creating room...')

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_CREATE, {
        secure: true,
        udp: false
      })
      setLastResult(response)

      if (!response.ok || !response.room) {
        const message = response.error || 'Failed creating P2PMD room'
        setP2pmdSetupError(message)
        setP2pmdSyncStatus('Ready')
        setStatus(message)
        return
      }

      setP2pmdSetupError(null)
      await loadP2pmdEditorHtml()
      setP2pmdRoom(response.room)
      setP2pmdUrl(response.room.localUrl)
      setStatus('P2PMD room created')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setP2pmdSetupError(message)
      setP2pmdSyncStatus('Ready')
      setStatus(message)
    } finally {
      setIsLoading(false)
    }
  }

  async function onP2pmdRoomJoin () {
    setIsLoading(true)
    setStatus('Joining P2PMD room...')
    setLastResult(null)
    setP2pmdRoom(null)
    setP2pmdUrl(null)
    setP2pmdParticipants(null)
    setP2pmdIsPreviewMode(false)
    setP2pmdPublishUrl(null)
    setP2pmdEditorHtml(null)
    setP2pmdSetupError(null)
    setP2pmdSyncStatus('Joining room...')

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_JOIN, {
        key: p2pmdJoinKey.trim(),
        udp: false
      })
      setLastResult(response)

      if (!response.ok || !response.room) {
        const message = response.error || 'Failed joining P2PMD room'
        setP2pmdSetupError(message)
        setP2pmdSyncStatus('Ready')
        setStatus(message)
        return
      }

      setP2pmdSetupError(null)
      await loadP2pmdEditorHtml()
      setP2pmdRoom(response.room)
      setP2pmdUrl(response.room.localUrl)
      setP2pmdSyncStatus(response.warning || 'Joining room page...')
      setStatus('P2PMD room joined')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setP2pmdSetupError(message)
      setP2pmdSyncStatus('Ready')
      setStatus(message)
    } finally {
      setIsLoading(false)
    }
  }

  async function onP2pmdRoomRefresh () {
    setIsLoading(true)
    setStatus('Reading P2PMD room status...')
    setLastResult(null)

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_STATUS, {})
      setLastResult(response)

      if (response.running && response.room) {
        await loadP2pmdEditorHtml()
        setP2pmdRoom(response.room)
        setP2pmdUrl(response.room.localUrl)
        setP2pmdParticipants(null)
        setP2pmdIsPreviewMode(false)
        setP2pmdPublishUrl(null)
        setP2pmdSetupError(null)
        setP2pmdSyncStatus('Ready')
      } else {
        setP2pmdRoom(null)
        setP2pmdUrl(null)
        setP2pmdParticipants(null)
        setP2pmdIsPreviewMode(false)
        setP2pmdPublishUrl(null)
        setP2pmdEditorHtml(null)
        setP2pmdSetupError(null)
        setP2pmdSyncStatus('Ready')
      }

      setStatus(response.running ? 'P2PMD room is running' : 'No P2PMD room is running')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function onP2pmdRoomDisconnect () {
    setIsLoading(true)
    setStatus('Disconnecting P2PMD room...')
    setLastResult(null)

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_DISCONNECT, {})
      setLastResult(response)
      setP2pmdUrl(null)
      setP2pmdRoom(null)
      setP2pmdParticipants(null)
      setP2pmdIsPreviewMode(false)
      setP2pmdPublishUrl(null)
      setP2pmdEditorHtml(null)
      setP2pmdSetupError(null)
      setP2pmdSyncStatus('Ready')
      setStatus(response.ok ? 'P2PMD room disconnected' : (response.error || 'Failed disconnecting P2PMD room'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function onP2pmdShareRoom () {
    if (!p2pmdRoom) return

    try {
      await Share.share({
        title: 'Join my P2PMD room',
        message: `Join my P2PMD room:\n${p2pmdRoom.key}`
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function loadP2pmdEditorHtml () {
    const response = await callRpc(RPC_P2PMD_EDITOR_PAGE, {})
    if (!response.ok || typeof response.html !== 'string') {
      throw new Error(response.error || 'Unable to load P2PMD editor page')
    }

    setP2pmdEditorHtml(response.html)
  }

  function onP2pmdTogglePreview () {
    p2pmdWebViewRef.current?.injectJavaScript(
      'window.__p2pmdTogglePreview && window.__p2pmdTogglePreview(); true;'
    )
  }

  function onP2pmdPublishToHyper () {
    if (p2pmdPublishInFlightRef.current) return
    setP2pmdSyncStatus('Publishing to Hyper...')
    p2pmdWebViewRef.current?.injectJavaScript(
      'window.__p2pmdPublishToHyper && window.__p2pmdPublishToHyper(); true;'
    )
  }

  async function publishP2pmdContentToHyper (content: unknown) {
    if (p2pmdPublishInFlightRef.current) return

    if (typeof content !== 'string') {
      setP2pmdSyncStatus('Publish failed')
      setStatus('Unable to publish P2PMD note: invalid document content')
      return
    }

    p2pmdPublishInFlightRef.current = true
    setIsP2pmdPublishing(true)

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_PUBLISH, {
        content
      })
      setLastResult(response)

      if (!response.ok || typeof response.url !== 'string') {
        throw new Error(response.error || 'Unable to publish note to Hyper')
      }

      setP2pmdPublishUrl(response.url)
      setP2pmdSyncStatus('Published to Hyper')
      setStatus(`P2PMD published: ${response.url}`)
      try {
        await Share.share({
          title: 'Published P2PMD note',
          message: response.url
        })
      } catch {}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setP2pmdSyncStatus(`Publish failed: ${message}`)
      setStatus(message)
    } finally {
      p2pmdPublishInFlightRef.current = false
      setIsP2pmdPublishing(false)
    }
  }

  async function handleP2pmdBridgeRequest (request: Record<string, unknown>) {
    const requestId = typeof request.requestId === 'string' ? request.requestId : ''
    const action = typeof request.action === 'string' ? request.action : ''
    const payload = request.payload && typeof request.payload === 'object'
      ? request.payload
      : {}

    if (!requestId) return

    try {
      const response = action === 'preview'
        ? await callRpc(RPC_P2PMD_PREVIEW, payload)
        : action === 'hyper-image'
          ? await callRpc(RPC_P2PMD_IMAGE_UPLOAD, payload)
          : { ok: false, error: `Unsupported P2PMD bridge action: ${action}` }

      setLastResult(response)
      resolveP2pmdBridgeRequest(requestId, response)
    } catch (error) {
      resolveP2pmdBridgeRequest(requestId, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  function resolveP2pmdBridgeRequest (requestId: string, response: RpcResponse | { ok: boolean, error?: string }) {
    p2pmdWebViewRef.current?.injectJavaScript(
      `window.__p2pmdResolveBridgeRequest && window.__p2pmdResolveBridgeRequest(${JSON.stringify(requestId)}, ${JSON.stringify(response)}); true;`
    )
  }

  function onP2pmdWebViewMessage (message: string) {
    try {
      const parsed = JSON.parse(message)

      switch (parsed.type) {
        case 'p2pmd-bridge-request':
          void handleP2pmdBridgeRequest(parsed)
          break
        case 'p2pmd-peers':
          if (Number.isInteger(parsed.count) && parsed.count >= 0) {
            setP2pmdParticipants(parsed.count)
          }
          break
        case 'p2pmd-document-loaded':
          setP2pmdSyncStatus('Loaded')
          setStatus('P2PMD document loaded')
          break
        case 'p2pmd-document-pending':
          setP2pmdSyncStatus('Unsaved changes')
          break
        case 'p2pmd-document-syncing':
          setP2pmdSyncStatus('Syncing...')
          break
        case 'p2pmd-document-saved':
          setP2pmdSyncStatus('Saved')
          setStatus(`P2PMD saved (${parsed.contentLength} characters)`)
          break
        case 'p2pmd-document-updated':
          setP2pmdSyncStatus('Remote update')
          setStatus(`P2PMD remote update received (${parsed.contentLength} characters)`)
          break
        case 'p2pmd-document-error':
          setP2pmdSyncStatus(parsed.error ? `Error: ${parsed.error}` : 'Sync error')
          setStatus(parsed.error || 'P2PMD document request failed')
          break
        case 'p2pmd-preview-mode':
          setP2pmdIsPreviewMode(Boolean(parsed.preview))
          setStatus(parsed.preview ? 'P2PMD preview mode' : 'P2PMD write mode')
          break
        case 'p2pmd-image-uploaded':
          setP2pmdSyncStatus('Image uploaded')
          break
        case 'p2pmd-publish-requested':
          void publishP2pmdContentToHyper(parsed.content)
          break
        default:
          setStatus('P2PMD editor connected')
      }
    } catch {
      setStatus('P2PMD editor connected')
    }
  }

  const canBrowserGoBack = browserSource.kind === 'web'
    ? browserWebCanGoBack || browserCanGoBack
    : browserCanGoBack
  const canBrowserGoForward = browserSource.kind === 'web'
    ? browserWebCanGoForward || browserCanGoForward
    : browserCanGoForward
  const browserIsDark = resolveBrowserDarkMode(browserPreferences.theme, systemColorScheme)
  const browserChrome = getBrowserPalette(browserIsDark)
  const browserBookmarkActionAvailable = canBookmarkBrowserPage(
    browserSource.kind,
    browserCurrentUrl
  )
  const browserPageIsBookmarked = browserBookmarkActionAvailable &&
    isBrowserPageBookmarked(browserCurrentUrl)
  const activeBrowserPageZoom = normalizeBrowserPageZoom(
    browserTabsState.tabs.find((tab) => tab.id === browserTabsState.activeTabId)?.pageZoom
  )
  const activeBrowserDesktopView = browserTabsState.tabs
    .find((tab) => tab.id === browserTabsState.activeTabId)?.desktopView === true

  useEffect(() => {
    if (Platform.OS !== 'android') return

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (browserZoomVisible) setBrowserZoomVisible(false)
      else if (browserMenuVisible) setBrowserMenuVisible(false)
      else if (browserTabsVisible) setBrowserTabsVisible(false)
      else if (browserBookmarksVisible) setBrowserBookmarksVisible(false)
      else if (browserHistoryVisible) setBrowserHistoryVisible(false)
      else if (browserDownloadsVisible) setBrowserDownloadsVisible(false)
      else if (browserSettingsVisible) setBrowserSettingsVisible(false)
      else if (canBrowserGoBack) onBrowserBack()
      else return false

      return true
    })

    return () => subscription.remove()
  }, [
    browserBookmarksVisible,
    browserDownloadsVisible,
    browserHistory,
    browserHistoryIndex,
    browserHistoryVisible,
    browserMenuVisible,
    browserSettingsVisible,
    browserSource.kind,
    browserTabsState.activeTabId,
    browserTabsVisible,
    browserWebCanGoBack,
    browserZoomVisible,
    canBrowserGoBack
  ])

  if (browserBookmarksVisible) {
    return (
      <SafeAreaView
        style={[styles.browserShell, { backgroundColor: browserChrome.shell }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <StatusBar
          backgroundColor={browserChrome.shell}
          barStyle={browserIsDark ? 'light-content' : 'dark-content'}
        />
        <BookmarksScreen
          bookmarks={browserBookmarks}
          isDark={browserIsDark}
          isReady={browserBookmarksReady}
          persistenceError={browserBookmarksError}
          onClose={() => setBrowserBookmarksVisible(false)}
          onOpen={(targetUrl) => {
            setBrowserBookmarksVisible(false)
            void loadBrowserUrl(targetUrl)
          }}
          onRemove={(targetUrl) => {
            if (removeBrowserBookmark(targetUrl)) setStatus('Bookmark removed')
          }}
        />
      </SafeAreaView>
    )
  }

  if (browserHistoryVisible) {
    return (
      <SafeAreaView
        style={[styles.browserShell, { backgroundColor: browserChrome.shell }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <StatusBar
          backgroundColor={browserChrome.shell}
          barStyle={browserIsDark ? 'light-content' : 'dark-content'}
        />
        <HistoryScreen
          error={browserHistoryError}
          isDark={browserIsDark}
          isReady={browserHistoryReady}
          items={browserVisitHistory}
          onClear={() => {
            if (clearBrowserHistory()) setStatus('Browsing history cleared')
          }}
          onClose={() => setBrowserHistoryVisible(false)}
          onOpen={(targetUrl) => {
            setBrowserHistoryVisible(false)
            setActiveTab('hyper')
            void loadBrowserUrl(targetUrl)
          }}
          onRemove={(item) => {
            if (removeBrowserHistoryItem(item)) setStatus('History entry removed')
          }}
        />
      </SafeAreaView>
    )
  }

  if (browserDownloadsVisible) {
    return (
      <SafeAreaView
        style={[styles.browserShell, { backgroundColor: browserChrome.shell }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <StatusBar
          backgroundColor={browserChrome.shell}
          barStyle={browserIsDark ? 'light-content' : 'dark-content'}
        />
        <DownloadsScreen
          downloads={browserDownloads}
          error={browserDownloadsError}
          isDark={browserIsDark}
          isReady={browserDownloadsReady}
          onClose={() => setBrowserDownloadsVisible(false)}
          onOpen={(downloadId) => void openBrowserDownload(downloadId)}
          onRefresh={() => void refreshBrowserDownloads()}
          onRemove={(downloadId) => void removeBrowserDownload(downloadId)}
        />
      </SafeAreaView>
    )
  }

  if (browserSettingsVisible) {
    return (
      <SafeAreaView
        style={[styles.browserShell, { backgroundColor: browserChrome.shell }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
        <StatusBar
          backgroundColor={browserChrome.shell}
          barStyle={browserIsDark ? 'light-content' : 'dark-content'}
        />
        <SettingsScreen
          addressBarPosition={browserPreferences.addressBarPosition}
          customSearchUrl={browserPreferences.customSearchUrl}
          enforceManualPageZoom={browserPreferences.enforceManualPageZoom}
          externalLinkBehavior={browserPreferences.externalLinkBehavior}
          isDark={browserIsDark}
          persistenceError={browserPreferencesError}
          restoreTabsOnStartup={browserPreferences.restoreTabsOnStartup}
          searchEngine={browserPreferences.searchEngine}
          showFullAddress={browserPreferences.showFullAddress}
          theme={browserPreferences.theme}
          websiteTextScale={browserPreferences.websiteTextScale}
          onAddressBarPositionChange={setAddressBarPosition}
          onClose={() => setBrowserSettingsVisible(false)}
          onClearBrowsingData={() => {
            const { sessionSaved } = onBrowserResetTabs(false)
            const historyCleared = clearBrowserHistory()
            if (sessionSaved && historyCleared) setBrowserSettingsVisible(false)
            return sessionSaved && historyCleared
          }}
          onClearCachedData={clearCachedBrowserTabPreviews}
          onCustomSearchSave={setCustomSearchEngine}
          onEnforceManualPageZoomChange={setEnforceManualPageZoom}
          onExternalLinkBehaviorChange={setExternalLinkBehavior}
          onRestoreTabsOnStartupChange={setRestoreTabsOnStartup}
          onSearchEngineChange={setSearchEngine}
          onShowFullAddressChange={setShowFullAddress}
          onThemeChange={setTheme}
          onWebsiteTextScaleChange={setWebsiteTextScale}
          onResetTabs={onBrowserResetTabs}
          onOpenUrl={(targetUrl) => {
            setBrowserSettingsVisible(false)
            void loadBrowserUrl(targetUrl)
          }}
        />
      </SafeAreaView>
    )
  }

  if (activeTab === 'p2pmd' && p2pmdRoom && p2pmdUrl && p2pmdEditorHtml) {
    const p2pmdEditorRoomBaseUrl = p2pmdUrl.replace(/\/$/, '')
    const p2pmdEditorBaseUrl = `${p2pmdEditorRoomBaseUrl}/?role=${encodeURIComponent(p2pmdRoom.role)}`
    const p2pmdEditorHtmlWithRoomBase = p2pmdEditorHtml.replace(
      '<head>',
      `<head><script>window.__P2PMD_ROOM_BASE_URL__=${JSON.stringify(p2pmdEditorRoomBaseUrl)};</script>`
    )

    return (
      <SafeAreaView style={styles.p2pmdWorkspace} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar backgroundColor='#1f2027' barStyle='light-content' />
        <View style={styles.p2pmdWorkspaceHeader}>
          <Text style={styles.p2pmdWorkspaceTitle}>P2PMD</Text>
          <Text style={[styles.p2pmdWorkspaceRole, p2pmdRoom.role === 'host' ? styles.p2pmdWorkspaceRoleHost : null]}>
            {p2pmdRoom.role}
          </Text>
          <Text style={styles.p2pmdWorkspaceParticipants}>
            Peers: {p2pmdParticipants ?? '-'}
          </Text>
          <Pressable
            style={styles.p2pmdPreviewButton}
            onPress={onP2pmdTogglePreview}
            disabled={isBooting || isLoading}
          >
            <View style={styles.p2pmdPreviewButtonContent}>
              {p2pmdIsPreviewMode
                ? (
                  <View style={styles.p2pmdPencilIcon}>
                    <View style={styles.p2pmdPencilBody} />
                    <View style={styles.p2pmdPencilTip} />
                  </View>
                  )
                : (
                  <View style={styles.p2pmdEyeIcon}>
                    <View style={styles.p2pmdEyeIconDot} />
                  </View>
                  )}
              <Text style={styles.p2pmdPreviewButtonText}>
                {p2pmdIsPreviewMode ? 'Edit' : 'Preview'}
              </Text>
            </View>
          </Pressable>
          <BrowserOverflowMenu
            bookmarkActionAvailable={false}
            bookmarksDisabled={!browserBookmarksReady}
            isBookmarked={false}
            newTabDisabled={browserTabsState.tabs.length >= MAX_BROWSER_TABS}
            visible={browserMenuVisible}
            onClose={() => setBrowserMenuVisible(false)}
            onNewTab={onBrowserNewTab}
            onOpenBookmarks={onBrowserOpenBookmarks}
            onOpenDownloads={onBrowserOpenDownloads}
            onOpenHistory={onBrowserOpenHistory}
            onShow={() => setBrowserMenuVisible(true)}
            onOpenSettings={() => {
              setBrowserMenuVisible(false)
              setBrowserSettingsVisible(true)
            }}
          />
        </View>

        <View style={styles.p2pmdWorkspaceMeta}>
          <View style={styles.p2pmdRoomIdentity}>
            <View style={styles.p2pmdWorkspaceKeyRow}>
              <Text style={styles.p2pmdWorkspaceKeyLabel}>Key</Text>
              <Text numberOfLines={1} ellipsizeMode='middle' style={styles.p2pmdWorkspaceKey}>
                {p2pmdRoom.key}
              </Text>
            </View>
            <Text numberOfLines={1} ellipsizeMode='middle' style={styles.p2pmdWorkspaceUrl}>
              {p2pmdRoom.localUrl}
            </Text>
            {p2pmdPublishUrl && (
              <View style={styles.p2pmdPublishedUrlRow}>
                <Text style={styles.p2pmdPublishedUrlLabel}>Published</Text>
                <Text numberOfLines={1} ellipsizeMode='middle' style={styles.p2pmdPublishedUrl}>
                  {p2pmdPublishUrl}
                </Text>
              </View>
            )}
            <Text numberOfLines={1} style={styles.p2pmdWorkspaceSyncStatus}>
              {p2pmdSyncStatus}
            </Text>
          </View>
          <Pressable
            style={styles.p2pmdMetaButton}
            onPress={onP2pmdPublishToHyper}
            disabled={isBooting || isLoading || isP2pmdPublishing}
          >
            <Text style={styles.p2pmdMetaButtonText}>Publish</Text>
          </Pressable>
          <Pressable
            style={styles.p2pmdMetaButton}
            onPress={() => void onP2pmdShareRoom()}
            disabled={isBooting || isLoading}
          >
            <Text style={styles.p2pmdMetaButtonText}>Share</Text>
          </Pressable>
          <Pressable
            style={[styles.p2pmdMetaButton, styles.p2pmdMetaButtonDanger]}
            onPress={() => void onP2pmdRoomDisconnect()}
            disabled={isBooting || isLoading}
          >
            <Text style={styles.p2pmdMetaButtonText}>Leave</Text>
          </Pressable>
        </View>
        <WebView
          key={`${p2pmdRoom.role}:${p2pmdEditorBaseUrl}:${p2pmdEditorHtml.length}`}
          ref={p2pmdWebViewRef}
          source={{
            html: p2pmdEditorHtmlWithRoomBase,
            baseUrl: p2pmdEditorBaseUrl
          }}
          cacheEnabled={false}
          textZoom={100}
          style={styles.p2pmdWorkspaceWebView}
          onMessage={(event) => onP2pmdWebViewMessage(event.nativeEvent.data)}
          onError={(event) => {
            setStatus(`P2PMD WebView failed: ${event.nativeEvent.description}`)
          }}
          onLoad={() => {
            if (p2pmdRoom.role === 'client') {
              setStatus('P2PMD joined room page loaded')
            }
          }}
        />

        {(isBooting || isLoading) && (
          <View style={styles.p2pmdWorkspaceLoader}>
            <ActivityIndicator size='small' />
          </View>
        )}
      </SafeAreaView>
    )
  }

  const browserToolbar = (
    <BrowserToolbar
      address={browserAddress}
      bookmarkActionAvailable={browserBookmarkActionAvailable}
      bookmarksDisabled={!browserBookmarksReady}
      canGoBack={canBrowserGoBack}
      canGoForward={canBrowserGoForward}
      desktopView={activeBrowserDesktopView}
      isBookmarked={browserPageIsBookmarked}
      isDark={browserIsDark}
      isLoading={browserIsLoading}
      historySuggestions={getBrowserHistorySuggestions(browserAddress)}
      menuVisible={browserMenuVisible}
      newTabDisabled={browserTabsState.tabs.length >= MAX_BROWSER_TABS}
      palette={browserChrome}
      position={browserPreferences.addressBarPosition}
      showFullAddress={browserPreferences.showFullAddress}
      shareActionAvailable={browserBookmarkActionAvailable}
      tabCount={browserTabsState.tabs.length}
      onAddressChange={(value) => {
        browserUserInteractedRef.current = true
        setBrowserAddress(value)
      }}
      onBack={onBrowserBack}
      onCloseMenu={() => setBrowserMenuVisible(false)}
      onForward={onBrowserForward}
      onOpenMenu={() => setBrowserMenuVisible(true)}
      onNewTab={onBrowserNewTab}
      onOpenBookmarks={onBrowserOpenBookmarks}
      onOpenDownloads={onBrowserOpenDownloads}
      onOpenHistory={onBrowserOpenHistory}
      onOpenSettings={() => {
        setBrowserMenuVisible(false)
        setBrowserSettingsVisible(true)
      }}
      onOpenTabs={() => {
        browserUserInteractedRef.current = true
        setBrowserTabsVisible(true)
      }}
      onOpenZoom={() => setBrowserZoomVisible(true)}
      onReload={onBrowserReload}
      onSharePage={() => void onBrowserSharePage()}
      onSubmit={() => void onBrowserSubmit()}
      onSuggestionPress={(targetUrl) => {
        setBrowserAddress(targetUrl)
        void loadBrowserUrl(targetUrl)
      }}
      onToggleDesktopView={onBrowserToggleDesktopView}
      onToggleBookmark={onBrowserToggleBookmark}
    />
  )
  const runtimeInputTheme = {
    backgroundColor: browserChrome.address,
    borderColor: browserChrome.border,
    color: browserChrome.text
  }
  const browserTabManagerItems = browserTabsState.tabs.map((tab) => {
    const entry = tab.history[tab.historyIndex]
    const storedPreview = browserTabPreviews.get(tab.id)
    const preview = storedPreview && entry &&
      isBrowserTabPreviewForPage(storedPreview.pageKey, entry.url)
      ? storedPreview
      : null

    return {
      favicon: browserFaviconsRef.current.get(tab.id) || null,
      id: tab.id,
      isActive: tab.id === browserTabsState.activeTabId,
      label: getBrowserTabLabel(tab),
      preview
    }
  })

  return (
    <SafeAreaView
      style={[styles.browserShell, { backgroundColor: browserChrome.shell }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
        <StatusBar
          backgroundColor={browserChrome.shell}
          barStyle={browserIsDark ? 'light-content' : 'dark-content'}
        />
        <KeyboardAvoidingView
          behavior='padding'
          enabled={browserPreferences.addressBarPosition === 'bottom'}
          style={styles.browserShellContent}
        >
        {browserPreferences.addressBarPosition === 'top' && browserToolbar}

        <BrowserTabsScreen
          items={browserTabManagerItems}
          newTabDisabled={browserTabsState.tabs.length >= MAX_BROWSER_TABS}
          palette={browserChrome}
          viewMode={browserTabsState.viewMode}
          visible={browserTabsVisible}
          onBurnTabs={onBrowserBurnTabs}
          onClose={() => setBrowserTabsVisible(false)}
          onCloseTab={onBrowserCloseTab}
          onNewTab={onBrowserNewTab}
          onPreviewError={clearBrowserTabPreview}
          onSwitchTab={onBrowserSwitchTab}
          onToggleView={onBrowserToggleTabView}
        />

        <View
          style={[styles.browserContent, { backgroundColor: browserChrome.shell }]}
          onTouchStart={Keyboard.dismiss}
        >
        {browserSource.kind === 'home'
          ? (
            <ScrollView
              style={styles.browserContentPage}
              contentContainerStyle={styles.browserHome}
              keyboardDismissMode='on-drag'
            >
              <View style={styles.browserShortcutGrid}>
                {INTERNAL_APPS.filter((app) => app.id !== 'holesail').map((app) => (
                  <Pressable
                    key={app.id}
                    style={styles.browserShortcut}
                    onPress={() => void loadBrowserUrl(app.url)}
                  >
                    <View style={[styles.browserShortcutIcon, getRuntimeAppIconStyle(app.id)]}>
                      <Text style={styles.browserShortcutIconText}>{app.icon}</Text>
                    </View>
                    <Text numberOfLines={2} style={[styles.browserShortcutTitle, { color: browserChrome.text }]}>
                      {app.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            )
          : browserSource.kind === 'app'
            ? (
              <ScrollView
                style={[
                  styles.browserContentPage,
                  activeTab !== 'p2pmd' ? { backgroundColor: browserChrome.surface } : null
                ]}
                contentContainerStyle={[
                styles.content,
                activeTab === 'p2pmd' ? styles.p2pmdAppContent : null
                ]}
                keyboardDismissMode='on-drag'
              >
                {activeTab !== 'p2pmd' && (
                  <View style={styles.runtimeHeader}>
                    <Text style={[styles.title, { color: browserChrome.text }]}>
                      {getRuntimeAppTitle(activeTab)}
                    </Text>
                  </View>
                )}
                {shouldShowRuntimeStatus && (
                  <Text style={[styles.status, { color: browserChrome.text }]}>{status}</Text>
                )}

                {activeTab === 'hyper' && (
                  <View style={[styles.section, { borderColor: browserChrome.border }]}>
                    <Text style={[styles.sectionTitle, { color: browserChrome.text }]}>Hyper Runtime Check</Text>
                    <TextInput
                      style={[styles.input, runtimeInputTheme]}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={url}
                      onChangeText={setUrl}
                      placeholder='hyper://...'
                      placeholderTextColor={browserChrome.mutedText}
                    />

                    <View style={styles.buttons}>
                      <Button
                        title='Create Drive'
                        onPress={() => void onCreateDrive()}
                        disabled={isBooting || isLoading}
                      />
                      <Button
                        title='Fetch URL'
                        onPress={() => void onFetch()}
                        disabled={isBooting || isLoading}
                      />
                    </View>
                  </View>
                )}
                {activeTab === 'holesail' && (
                  <View style={[styles.section, { borderColor: browserChrome.border }]}>
                    <Text style={[styles.sectionTitle, { color: browserChrome.text }]}>Holesail Runtime Check</Text>
                    <TextInput
                      style={[styles.input, runtimeInputTheme]}
                      autoCapitalize='none'
                      autoCorrect={false}
                      keyboardType='numeric'
                      value={hsLivePort}
                      onChangeText={setHsLivePort}
                      placeholder='Live port (for --live)'
                      placeholderTextColor={browserChrome.mutedText}
                    />
                    <TextInput
                      style={[styles.input, runtimeInputTheme]}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsLiveHost}
                      onChangeText={setHsLiveHost}
                      placeholder='Live host (default 127.0.0.1)'
                      placeholderTextColor={browserChrome.mutedText}
                    />
                    <TextInput
                      style={[styles.input, runtimeInputTheme]}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsConnector}
                      onChangeText={setHsConnector}
                      placeholder='Optional custom connection string'
                      placeholderTextColor={browserChrome.mutedText}
                    />
                    <View style={styles.buttons}>
                      <Button
                        title='Start Live'
                        onPress={() => void onHolesailStartLive()}
                        disabled={isBooting || isLoading}
                      />
                      <Button
                        title='Status'
                        onPress={() => void onHolesailStatus()}
                        disabled={isBooting || isLoading}
                      />
                    </View>

                    <TextInput
                      style={[styles.input, runtimeInputTheme]}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsConnectKey}
                      onChangeText={setHsConnectKey}
                      placeholder='hs://... connection key'
                      placeholderTextColor={browserChrome.mutedText}
                    />
                    <TextInput
                      style={[styles.input, runtimeInputTheme]}
                      autoCapitalize='none'
                      autoCorrect={false}
                      keyboardType='numeric'
                      value={hsConnectPort}
                      onChangeText={setHsConnectPort}
                      placeholder='Client bind port (default 8989)'
                      placeholderTextColor={browserChrome.mutedText}
                    />
                    <TextInput
                      style={[styles.input, runtimeInputTheme]}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsConnectHost}
                      onChangeText={setHsConnectHost}
                      placeholder='Client bind host (default 127.0.0.1)'
                      placeholderTextColor={browserChrome.mutedText}
                    />
                    <View style={styles.buttons}>
                      <Button
                        title='Connect'
                        onPress={() => void onHolesailConnect()}
                        disabled={isBooting || isLoading}
                      />
                      <Button
                        title='Stop'
                        onPress={() => void onHolesailStop()}
                        disabled={isBooting || isLoading}
                      />
                    </View>
                  </View>
                )}
                {activeTab === 'p2pmd' && (
                  <View style={styles.p2pmdSection}>
                    <View style={styles.p2pmdHeader}>
                      <View style={styles.p2pmdHeaderCopy}>
                        <Text style={[styles.sectionTitle, styles.p2pmdTitle]}>P2PMD</Text>
                        <Text style={styles.helperText}>
                          Create or join a Holesail-backed Markdown room, then edit together in the embedded mobile editor.
                        </Text>
                      </View>
                      <Text style={[styles.roomPill, p2pmdRoom ? styles.roomPillLive : null]}>
                        {p2pmdRoom ? 'live' : 'ready'}
                      </Text>
                    </View>
                    {!p2pmdRoom && (
                      <View style={styles.p2pmdSetupBlock}>
                        <Text style={styles.emptyRoomTitle}>Start a collaborative note</Text>
                        <Text style={styles.helperText}>
                          Create a room to host from this phone, or paste an hs:// key to join a room hosted elsewhere.
                        </Text>
                        <View style={styles.p2pmdActionRow}>
                          <Pressable
                            style={[styles.p2pmdPrimaryAction, isBooting || isLoading ? styles.p2pmdActionDisabled : null]}
                            onPress={() => void onP2pmdRoomCreate()}
                            disabled={isBooting || isLoading}
                          >
                            <Text style={styles.p2pmdPrimaryActionText}>Create Room</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.p2pmdTextAction, isBooting || isLoading ? styles.p2pmdActionDisabled : null]}
                            onPress={() => void onP2pmdRoomRefresh()}
                            disabled={isBooting || isLoading}
                          >
                            <Text style={styles.p2pmdTextActionText}>Refresh</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}

                    <View style={styles.p2pmdDividerRow}>
                      <View style={styles.p2pmdDividerLine} />
                      <Text style={styles.p2pmdDividerText}>or join</Text>
                      <View style={styles.p2pmdDividerLine} />
                    </View>

                    <View style={styles.p2pmdSetupBlock}>
                      <Text style={styles.fieldLabel}>Join existing room</Text>
                      <Text style={styles.helperText}>
                        Paste a room key shared by another peer to connect through Holesail.
                      </Text>
                      <TextInput
                        style={[styles.input, styles.p2pmdInput]}
                        autoCapitalize='none'
                        autoCorrect={false}
                        value={p2pmdJoinKey}
                        onChangeText={(value) => {
                          setP2pmdJoinKey(value)
                          if (p2pmdSetupError) setP2pmdSetupError(null)
                        }}
                        placeholderTextColor='#6f7484'
                        placeholder='hs://... room key'
                      />
                      {p2pmdSetupError && (
                        <Text selectable={true} style={styles.p2pmdSetupError}>
                          {p2pmdSetupError}
                        </Text>
                      )}
                      <Pressable
                        style={[
                          styles.p2pmdJoinAction,
                          isBooting || isLoading || !p2pmdJoinKey.trim() ? styles.p2pmdActionDisabled : null
                        ]}
                        onPress={() => void onP2pmdRoomJoin()}
                        disabled={isBooting || isLoading || !p2pmdJoinKey.trim()}
                      >
                        <Text style={styles.p2pmdJoinActionText}>Join Room</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                {(isBooting || isLoading) && <ActivityIndicator size='small' />}

                {lastResult && activeTab !== 'p2pmd' && (
                  <View style={[styles.result, { backgroundColor: browserChrome.button }]}>
                    <Text selectable={true} style={[styles.resultText, { color: browserChrome.text }]}>
                      {JSON.stringify(lastResult, null, 2)}
                    </Text>
                  </View>
                )}
              </ScrollView>
              )
          : browserSource.kind === 'restore'
            ? (
              <View style={styles.browserRestorePage}>
                <ActivityIndicator size='small' color='#1f6fd1' />
                <Text style={styles.browserRestoreText}>Restoring tab...</Text>
              </View>
              )
            : null}

        {browserTabsState.tabs.map((tab) => {
          const entry = tab.history[tab.historyIndex]
          if (!entry || !isBrowserWebViewSource(entry.source)) return null
          if (!browserLiveTabIds.includes(tab.id)) return null

          const isActive = tab.id === browserTabsState.activeTabId
          const tabPageZoom = normalizeBrowserPageZoom(tab.pageZoom)
          const tabDesktopView = tab.desktopView === true
          const browserAccessibilityScript = createBrowserAccessibilityScript({
            applyTextScale: Platform.OS === 'ios',
            desktopView: tabDesktopView,
            enforceManualPageZoom: browserPreferences.enforceManualPageZoom,
            pageZoom: tabPageZoom,
            websiteTextScale: browserPreferences.websiteTextScale
          })
          const browserInjectedScript = combineBrowserInjectedScripts(
            browserAccessibilityScript,
            createBrowserFaviconScript()
          )

          return (
            <View
              key={tab.id}
              pointerEvents={isActive ? 'auto' : 'none'}
              style={[styles.browserWebViewLayer, !isActive ? styles.browserWebViewLayerHidden : null]}
            >
            <View
              ref={(ref) => {
                setBrowserPreviewView(tab.id, ref)
              }}
              onLayout={(event) => {
                const { height, width } = event.nativeEvent.layout
                setBrowserPreviewLayout(tab.id, width, height)
              }}
              collapsable={false}
              style={styles.browserWebViewCapture}
            >
            <WebView
              key={`${getBrowserWebViewKey(tab.id, entry.source.kind)}:${tabDesktopView ? 'desktop' : 'mobile'}`}
              ref={(ref) => {
                if (ref) {
                  browserWebViewRefs.current.set(tab.id, ref)
                } else {
                  browserWebViewRefs.current.delete(tab.id)
                }
              }}
              source={entry.source.kind === 'web'
                ? { uri: entry.source.uri }
                : {
                    html: entry.source.html,
                    baseUrl: entry.source.kind === 'hyper' ? entry.source.baseUrl : undefined
                  }}
              cacheEnabled={true}
              nativeConfig={peerSkyWebViewNativeConfig}
              injectedJavaScript={browserInjectedScript}
              injectedJavaScriptBeforeContentLoaded={browserAccessibilityScript}
              originWhitelist={['*']}
              scalesPageToFit={true}
              setBuiltInZoomControls={true}
              setDisplayZoomControls={false}
              textZoom={Math.round(browserPreferences.websiteTextScale * tabPageZoom / 100)}
              userAgent={tabDesktopView ? DESKTOP_BROWSER_USER_AGENT : undefined}
              style={styles.browserWebView}
              onShouldStartLoadWithRequest={(request) => onBrowserShouldStartLoad(tab.id, entry, request)}
              onOpenWindow={(event) => onBrowserOpenWindow(tab.id, entry, event.nativeEvent.targetUrl)}
              onFileDownload={(event) => {
                void requestBrowserDownload(event.nativeEvent.downloadUrl)
              }}
              scrollEventThrottle={200}
              onScroll={() => {
                Keyboard.dismiss()
                if (isCurrentBrowserTabEntry(browserTabsStateRef.current, tab.id, entry)) {
                  scheduleBrowserTabPreview(tab.id, entry)
                }
              }}
              onLoadStart={() => {
                browserFaviconsRef.current.delete(tab.id)
                if (
                  browserTabsStateRef.current.activeTabId === tab.id &&
                  isCurrentBrowserTabEntry(browserTabsStateRef.current, tab.id, entry)
                ) {
                  setBrowserFavicon(null)
                  setBrowserIsLoading(true)
                }
              }}
              onLoadEnd={() => {
                browserWebNavigationDirectionsRef.current.delete(tab.id)
                if (
                  browserTabsStateRef.current.activeTabId === tab.id &&
                  isCurrentBrowserTabEntry(browserTabsStateRef.current, tab.id, entry)
                ) {
                  setBrowserIsLoading(false)
                  scheduleBrowserTabPreview(tab.id, entry)
                }
              }}
              onNavigationStateChange={(navigationState) => {
                if (entry.source.kind !== 'web') return
                if (!isCurrentBrowserTabEntry(browserTabsStateRef.current, tab.id, entry)) return
                if (!isWebUrl(navigationState.url) || navigationState.url.length > MAX_BROWSER_URL_LENGTH) return

                if (!navigationState.loading) {
                  recordBrowserVisit({
                    url: navigationState.url,
                    title: navigationState.title || navigationState.url
                  })
                }

                if (browserTabsStateRef.current.activeTabId === tab.id) {
                  syncBrowserEntry(navigationState.url, {
                    kind: 'web',
                    uri: navigationState.url
                  }, {
                    canGoBack: navigationState.canGoBack,
                    canGoForward: navigationState.canGoForward
                  }, tab.id)
                  const title = normalizeBrowserTabTitle(navigationState.title || navigationState.url)
                  setBrowserTitle(title)
                  updateBrowserTabTitle(tab.id, title)
                  setBrowserIsLoading(navigationState.loading)
                } else {
                  syncBackgroundBrowserTab(tab.id, entry, navigationState)
                }
              }}
              onMessage={(event) => {
                if (!isCurrentBrowserTabEntry(browserTabsStateRef.current, tab.id, entry)) return

                const favicon = parseBrowserFaviconMessage(
                  event.nativeEvent.data,
                  event.nativeEvent.url || entry.url
                )
                if (favicon === undefined) return

                if (favicon) {
                  browserFaviconsRef.current.set(tab.id, favicon)
                } else {
                  browserFaviconsRef.current.delete(tab.id)
                }

                if (browserTabsStateRef.current.activeTabId === tab.id) {
                  setBrowserFavicon(favicon)
                }
              }}
              onError={(event) => {
                if (!isCurrentBrowserTabEntry(browserTabsStateRef.current, tab.id, entry)) return

                const candidateUrl = event.nativeEvent.url || entry.url
                const failedUrl = candidateUrl.length <= MAX_BROWSER_URL_LENGTH
                  ? candidateUrl
                  : entry.url
                const errorSource: BrowserSource = {
                  kind: 'error',
                  html: createBrowserErrorHtml(failedUrl, event.nativeEvent.description)
                }

                if (browserTabsStateRef.current.activeTabId === tab.id) {
                  replaceBrowserEntry(failedUrl, errorSource)
                  setBrowserTitle('Page failed')
                  setStatus(event.nativeEvent.description)
                } else {
                  updateBackgroundBrowserEntry(tab.id, entry, failedUrl, errorSource, true)
                }
              }}
            />
            </View>
            </View>
          )
        })}
        </View>

        {browserPreferences.addressBarPosition === 'bottom' && browserToolbar}

        <BrowserZoomSheet
          isDark={browserIsDark}
          pageZoom={activeBrowserPageZoom}
          visible={browserZoomVisible}
          onClose={() => setBrowserZoomVisible(false)}
          onReset={onBrowserResetZoom}
          onZoomIn={onBrowserZoomIn}
          onZoomOut={onBrowserZoomOut}
        />

        {isBooting && (
          <View style={styles.browserLoader}>
            <ActivityIndicator size='small' />
          </View>
        )}
        </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function toBareFsPath (uri: string) {
  if (!uri.startsWith('file://')) return uri
  return decodeURIComponent(new URL(uri).pathname).replace(/\/$/, '')
}

function getBrowserSessionFile () {
  return new File(Paths.document, 'browser-tabs.json')
}

function writeBrowserSession (state: BrowserTabsState) {
  try {
    const sessionFile = getBrowserSessionFile()
    if (!sessionFile.exists) sessionFile.create({ intermediates: true })
    sessionFile.write(serializeBrowserTabsState(state))
    return true
  } catch (error) {
    console.error('Failed saving browser tabs:', error)
    return false
  }
}

function isBrowserWebViewSource (
  source: BrowserSource
): source is Extract<BrowserSource, { kind: 'web' | 'hyper' | 'error' }> {
  return source.kind === 'web' || source.kind === 'hyper' || source.kind === 'error'
}

function getBrowserEntryTitle (entry: BrowserHistoryEntry) {
  if (entry.source.kind === 'app') return getRuntimeAppTitle(entry.source.app)
  return entry.url === BROWSER_HOME_URL ? 'PeerSky' : entry.url
}

function getBrowserTabLabel (tab: BrowserTab) {
  if (tab.title && tab.title !== BROWSER_HOME_URL) return tab.title

  const entry = tab.history[tab.historyIndex]
  if (!entry) return 'New Tab'

  return getBrowserEntryTitle(entry)
}

function getRuntimeAppIconStyle (app: RuntimeTab) {
  if (app === 'hyper') return styles.browserShortcutIconHyper
  if (app === 'holesail') return styles.browserShortcutIconHolesail
  return styles.browserShortcutIconP2pmd
}

function createHyperBrowserHtml (response: RpcResponse, targetUrl: string) {
  const body = response.body || ''
  const contentType = response.headers?.['content-type'] || ''

  if (contentType.includes('application/json')) {
    return createHyperDirectoryHtml(body, targetUrl)
  }

  if (contentType.includes('text/html') || looksLikeHtml(body)) {
    return ensureMobileViewport(body)
  }

  return createBrowserDocumentHtml(targetUrl, `<pre>${escapeHtml(body)}</pre>`)
}

function createHyperDirectoryHtml (body: string, targetUrl: string) {
  try {
    const files = JSON.parse(body)
    if (!Array.isArray(files)) throw new Error('Expected a directory listing')

    const links = files
      .map((file) => {
        const name = String(file)
        const href = createHyperChildUrl(targetUrl, name)
        return `<li><a href="${escapeHtmlAttribute(href)}">${escapeHtml(name)}</a></li>`
      })
      .join('')

    return createBrowserDocumentHtml(
      targetUrl,
      `<h1>Index of ${escapeHtml(targetUrl)}</h1><ul>${links || '<li>No files found.</li>'}</ul>`
    )
  } catch {
    return createBrowserDocumentHtml(targetUrl, `<pre>${escapeHtml(body)}</pre>`)
  }
}

function createBrowserErrorHtml (targetUrl: string, message: string) {
  return createBrowserDocumentHtml(
    'PeerSky could not load this page',
    `<h1>Page failed</h1><p class="muted">${escapeHtml(targetUrl)}</p><pre>${escapeHtml(message)}</pre>`
  )
}

function createBrowserDocumentHtml (title: string, body: string) {
  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body {
    color: #151821;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.55;
    margin: 0;
    padding: 22px;
  }
  a { color: #0f6fd4; }
  ul { padding-left: 20px; }
  li { margin: 10px 0; overflow-wrap: anywhere; }
  pre {
    background: #f4f6f8;
    border: 1px solid #dce2ea;
    border-radius: 8px;
    overflow: auto;
    padding: 14px;
    white-space: pre-wrap;
  }
  .muted {
    color: #657086;
    overflow-wrap: anywhere;
  }
</style>
${body}
`
}

function ensureMobileViewport (html: string) {
  if (/<meta\s+[^>]*name=["']viewport["'][^>]*>/i.test(html)) return html

  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1" />'

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>${viewport}`)
  }

  return `${viewport}\n${html}`
}

function createHyperChildUrl (baseUrl: string, childPath: string) {
  try {
    const parsed = new URL(baseUrl)
    const pathname = childPath.startsWith('/') ? childPath : `${parsed.pathname.replace(/\/?$/, '/')}${childPath}`
    return `hyper://${parsed.host}${pathname}`
  } catch {
    return childPath
  }
}

function looksLikeHtml (body: string) {
  return /^\s*<(?:!doctype|html|head|body|main|section|article|div|h1|p)\b/i.test(body)
}

function escapeHtml (value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeHtmlAttribute (value: string) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}
