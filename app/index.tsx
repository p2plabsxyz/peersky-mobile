import { type ComponentRef, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View
} from 'react-native'
import { Worklet } from 'react-native-bare-kit'
import { Paths } from 'expo-file-system'
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
  isHyperUrl,
  isStaleBrowserLoad,
  isWebUrl,
  normalizeBrowserAddress,
  replaceBrowserEntryState,
  syncBrowserEntryState
} from './browser-shell.mjs'
import {
  INTERNAL_APPS,
  type RuntimeTab,
  getRuntimeAppFromUrl,
  getRuntimeAppTitle,
  getRuntimeAppUrl
} from './internal-apps'
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
  storagePath?: string
  headers?: Record<string, string>
  running?: boolean
  host?: string
  port?: number
  localUrl?: string
  room?: P2pmdRoom | null
}

type BrowserSource =
  | { kind: 'home' }
  | { kind: 'app', app: RuntimeTab }
  | { kind: 'web', uri: string }
  | { kind: 'hyper', html: string, baseUrl: string }
  | { kind: 'error', html: string }

type BrowserHistoryEntry = {
  url: string
  source: BrowserSource
}

export default function App () {
  const workletRef = useRef<Worklet | null>(null)
  const rpcRef = useRef<RPC | null>(null)
  const browserWebViewRef = useRef<ComponentRef<typeof WebView> | null>(null)
  const p2pmdWebViewRef = useRef<ComponentRef<typeof WebView> | null>(null)
  const p2pmdPublishInFlightRef = useRef(false)
  const browserLoadSeqRef = useRef(0)
  const [isBooting, setIsBooting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('Starting Hyper runtime...')
  const [browserAddress, setBrowserAddress] = useState('')
  const [browserCurrentUrl, setBrowserCurrentUrl] = useState(BROWSER_HOME_URL)
  const [browserTitle, setBrowserTitle] = useState('PeerSky')
  const [browserSource, setBrowserSource] = useState<BrowserSource>({ kind: 'home' })
  const [browserHistory, setBrowserHistory] = useState<BrowserHistoryEntry[]>([
    { url: BROWSER_HOME_URL, source: { kind: 'home' } }
  ])
  const [browserHistoryIndex, setBrowserHistoryIndex] = useState(0)
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
  const [p2pmdJoinKey, setP2pmdJoinKey] = useState('')
  const [p2pmdParticipants, setP2pmdParticipants] = useState<number | null>(null)
  const [p2pmdIsPreviewMode, setP2pmdIsPreviewMode] = useState(false)
  const [p2pmdSyncStatus, setP2pmdSyncStatus] = useState('Ready')
  const [p2pmdPublishUrl, setP2pmdPublishUrl] = useState<string | null>(null)
  const [isP2pmdPublishing, setIsP2pmdPublishing] = useState(false)
  const shouldShowRuntimeStatus = activeTab !== 'p2pmd'

  useEffect(() => {
    void startWorklet()
    return () => {
      workletRef.current?.terminate()
      workletRef.current = null
      rpcRef.current = null
    }
  }, [])

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

  function syncBrowserEntry (url: string, source: BrowserSource) {
    applyBrowserState(syncBrowserEntryState(getBrowserState(), url, source))
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
  }) {
    setBrowserHistory(nextState.history)
    setBrowserHistoryIndex(nextState.historyIndex)
    setBrowserCurrentUrl(nextState.currentUrl)
    setBrowserAddress(nextState.address)
    setBrowserSource(nextState.source)
    setBrowserCanGoBack(nextState.canGoBack)
    setBrowserCanGoForward(nextState.canGoForward)

    if (typeof nextState.webCanGoBack === 'boolean') {
      setBrowserWebCanGoBack(nextState.webCanGoBack)
    }

    if (typeof nextState.webCanGoForward === 'boolean') {
      setBrowserWebCanGoForward(nextState.webCanGoForward)
    }
  }

  function cancelPendingBrowserLoad () {
    browserLoadSeqRef.current += 1
  }

  async function onBrowserSubmit () {
    await loadBrowserUrl(browserAddress)
  }

  async function loadBrowserUrl (rawUrl: string) {
    const nextUrl = normalizeBrowserAddress(rawUrl)

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

      const source: BrowserSource = {
        kind: 'hyper',
        html: createHyperBrowserHtml(response, nextUrl),
        baseUrl: nextUrl
      }

      if (shouldCommit) {
        commitBrowserEntry(response.url || nextUrl, source)
      } else {
        replaceBrowserEntry(response.url || nextUrl, source)
      }

      setBrowserTitle(response.url || nextUrl)
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
    cancelPendingBrowserLoad()

    if (browserSource.kind === 'web' && browserWebCanGoBack) {
      browserWebViewRef.current?.goBack()
      return
    }

    const nextState = getBrowserBackState(getBrowserState())
    if (!nextState) return

    const entry = nextState.history[nextState.historyIndex]
    applyBrowserState(nextState)
    setBrowserTitle(getBrowserEntryTitle(entry))
    if (entry.source.kind === 'app') setActiveTab(entry.source.app)
  }

  function onBrowserForward () {
    cancelPendingBrowserLoad()

    if (browserSource.kind === 'web' && browserWebCanGoForward) {
      browserWebViewRef.current?.goForward()
      return
    }

    const nextState = getBrowserForwardState(getBrowserState())
    if (!nextState) return

    const entry = nextState.history[nextState.historyIndex]
    applyBrowserState(nextState)
    setBrowserTitle(getBrowserEntryTitle(entry))
    if (entry.source.kind === 'app') setActiveTab(entry.source.app)
  }

  function onBrowserReload () {
    if (browserIsLoading && browserSource.kind === 'web') {
      cancelPendingBrowserLoad()
      browserWebViewRef.current?.stopLoading()
      return
    }

    if (browserSource.kind === 'web') {
      cancelPendingBrowserLoad()
      browserWebViewRef.current?.reload()
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

  function onBrowserShouldStartLoad (request: { url?: string }) {
    const action = getBrowserRequestAction({
      requestUrl: request.url,
      currentSourceKind: browserSource.kind
    })

    if (action.action === 'allow') return true

    if (action.action === 'load-hyper' && action.url) {
      void loadBrowserUrl(action.url)
      return false
    }

    if (action.action === 'commit-web' && action.url && action.source) {
      cancelPendingBrowserLoad()
      commitBrowserEntry(action.url, action.source as BrowserSource)
      setBrowserTitle(action.url)
      return false
    }

    return false
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
    setP2pmdSyncStatus('Creating room...')

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_CREATE, {
        secure: true,
        udp: false
      })
      setLastResult(response)

      if (!response.ok || !response.room) {
        setStatus(response.error || 'Failed creating P2PMD room')
        return
      }

      setP2pmdRoom(response.room)
      setP2pmdUrl(response.room.localUrl)
      setStatus('P2PMD room created')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
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
    setP2pmdSyncStatus('Joining room...')

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_JOIN, {
        key: p2pmdJoinKey.trim(),
        udp: false
      })
      setLastResult(response)

      if (!response.ok || !response.room) {
        setStatus(response.error || 'Failed joining P2PMD room')
        return
      }

      setP2pmdRoom(response.room)
      setP2pmdUrl(response.room.localUrl)
      setStatus('P2PMD room joined')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
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
        setP2pmdRoom(response.room)
        setP2pmdUrl(response.room.localUrl)
        setP2pmdParticipants(null)
        setP2pmdIsPreviewMode(false)
        setP2pmdPublishUrl(null)
        setP2pmdSyncStatus('Ready')
      } else {
        setP2pmdRoom(null)
        setP2pmdUrl(null)
        setP2pmdParticipants(null)
        setP2pmdIsPreviewMode(false)
        setP2pmdPublishUrl(null)
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

  function onP2pmdWebViewMessage (message: string) {
    try {
      const parsed = JSON.parse(message)

      switch (parsed.type) {
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

  if (activeTab === 'p2pmd' && p2pmdRoom && p2pmdUrl) {
    return (
      <SafeAreaView style={styles.p2pmdWorkspace} edges={['top', 'left', 'right', 'bottom']}>
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
          ref={p2pmdWebViewRef}
          source={{ uri: `${p2pmdUrl}?role=${encodeURIComponent(p2pmdRoom.role)}` }}
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

  return (
    <SafeAreaView style={styles.browserShell} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.browserToolbar}>
          <Pressable
            style={[styles.browserNavButton, !canBrowserGoBack ? styles.browserNavButtonDisabled : null]}
            onPress={onBrowserBack}
            disabled={!canBrowserGoBack}
          >
            <Text style={styles.browserNavButtonText}>{'<'}</Text>
          </Pressable>
          <Pressable
            style={[styles.browserNavButton, !canBrowserGoForward ? styles.browserNavButtonDisabled : null]}
            onPress={onBrowserForward}
            disabled={!canBrowserGoForward}
          >
            <Text style={styles.browserNavButtonText}>{'>'}</Text>
          </Pressable>
          <TextInput
            style={styles.browserAddress}
            autoCapitalize='none'
            autoCorrect={false}
            keyboardType='url'
            returnKeyType='go'
            value={browserAddress}
            onChangeText={setBrowserAddress}
            onSubmitEditing={() => void onBrowserSubmit()}
            placeholder='Search or enter address'
            placeholderTextColor='#7d8494'
          />
          <Pressable style={styles.browserActionButton} onPress={onBrowserReload}>
            {browserIsLoading
              ? <ActivityIndicator color='#ffffff' size='small' />
              : <Text style={styles.browserActionButtonText}>↻</Text>}
          </Pressable>
        </View>

        {browserSource.kind === 'home'
          ? (
            <ScrollView contentContainerStyle={styles.browserHome}>
              <View style={styles.browserShortcutGrid}>
                <Pressable
                  style={styles.browserShortcut}
                  onPress={() => void loadBrowserUrl('hyper://peersky.p2plabs.xyz/')}
                >
                  <View style={[styles.browserShortcutIcon, styles.browserShortcutIconPeerSky]}>
                    <Text style={styles.browserShortcutIconText}>P</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.browserShortcutTitle}>PeerSky Browser</Text>
                </Pressable>
                <Pressable
                  style={styles.browserShortcut}
                  onPress={() => void loadBrowserUrl('hyper://akhilesh.art/')}
                >
                  <View style={[styles.browserShortcutIcon, styles.browserShortcutIconAkhilesh]}>
                    <Text style={styles.browserShortcutIconText}>AT</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.browserShortcutTitle}>Akhilesh Thite</Text>
                </Pressable>
                {INTERNAL_APPS.map((app) => (
                  <Pressable
                    key={app.id}
                    style={styles.browserShortcut}
                    onPress={() => void loadBrowserUrl(app.url)}
                  >
                    <View style={[styles.browserShortcutIcon, getRuntimeAppIconStyle(app.id)]}>
                      <Text style={styles.browserShortcutIconText}>{app.icon}</Text>
                    </View>
                    <Text numberOfLines={2} style={styles.browserShortcutTitle}>{app.title}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            )
          : browserSource.kind === 'app'
            ? (
              <ScrollView contentContainerStyle={[
                styles.content,
                activeTab === 'p2pmd' ? styles.p2pmdAppContent : null
              ]}>
                {activeTab !== 'p2pmd' && (
                  <View style={styles.runtimeHeader}>
                    <Text style={styles.title}>
                      {getRuntimeAppTitle(activeTab)}
                    </Text>
                  </View>
                )}
                {shouldShowRuntimeStatus && <Text style={styles.status}>{status}</Text>}

                {activeTab === 'hyper' && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Hyper Runtime Check</Text>
                    <TextInput
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={url}
                      onChangeText={setUrl}
                      placeholder='hyper://...'
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
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Holesail Runtime Check</Text>
                    <TextInput
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                      keyboardType='numeric'
                      value={hsLivePort}
                      onChangeText={setHsLivePort}
                      placeholder='Live port (for --live)'
                    />
                    <TextInput
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsLiveHost}
                      onChangeText={setHsLiveHost}
                      placeholder='Live host (default 127.0.0.1)'
                    />
                    <TextInput
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsConnector}
                      onChangeText={setHsConnector}
                      placeholder='Optional custom connection string'
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
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsConnectKey}
                      onChangeText={setHsConnectKey}
                      placeholder='hs://... connection key'
                    />
                    <TextInput
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                      keyboardType='numeric'
                      value={hsConnectPort}
                      onChangeText={setHsConnectPort}
                      placeholder='Client bind port (default 8989)'
                    />
                    <TextInput
                      style={styles.input}
                      autoCapitalize='none'
                      autoCorrect={false}
                      value={hsConnectHost}
                      onChangeText={setHsConnectHost}
                      placeholder='Client bind host (default 127.0.0.1)'
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
                        onChangeText={setP2pmdJoinKey}
                        placeholderTextColor='#6f7484'
                        placeholder='hs://... room key'
                      />
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
                  <View style={styles.result}>
                    <Text selectable={true} style={styles.resultText}>
                      {JSON.stringify(lastResult, null, 2)}
                    </Text>
                  </View>
                )}
              </ScrollView>
              )
          : (
            <WebView
              ref={browserWebViewRef}
              source={browserSource.kind === 'web'
                ? { uri: browserSource.uri }
                : { html: browserSource.html, baseUrl: browserSource.kind === 'hyper' ? browserSource.baseUrl : undefined }}
              originWhitelist={['*']}
              textZoom={100}
              style={styles.browserWebView}
              onShouldStartLoadWithRequest={onBrowserShouldStartLoad}
              onLoadStart={() => {
                setBrowserIsLoading(true)
              }}
              onLoadEnd={() => {
                setBrowserIsLoading(false)
              }}
              onNavigationStateChange={(navigationState) => {
                if (browserSource.kind !== 'web') return

                setBrowserWebCanGoBack(navigationState.canGoBack)
                setBrowserWebCanGoForward(navigationState.canGoForward)
                syncBrowserEntry(navigationState.url, {
                  kind: 'web',
                  uri: navigationState.url
                })
                setBrowserTitle(navigationState.title || navigationState.url)
                setBrowserIsLoading(navigationState.loading)
              }}
              onError={(event) => {
                const failedUrl = event.nativeEvent.url || browserCurrentUrl
                replaceBrowserEntry(failedUrl, {
                  kind: 'error',
                  html: createBrowserErrorHtml(failedUrl, event.nativeEvent.description)
                })
                setBrowserTitle('Page failed')
                setStatus(event.nativeEvent.description)
              }}
            />
            )}

        {isBooting && (
          <View style={styles.browserLoader}>
            <ActivityIndicator size='small' />
          </View>
        )}
    </SafeAreaView>
  )
}

function toBareFsPath (uri: string) {
  if (!uri.startsWith('file://')) return uri
  return decodeURIComponent(new URL(uri).pathname).replace(/\/$/, '')
}

function getBrowserEntryTitle (entry: BrowserHistoryEntry) {
  if (entry.source.kind === 'app') return getRuntimeAppTitle(entry.source.app)
  return entry.url === BROWSER_HOME_URL ? 'PeerSky' : entry.url
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
