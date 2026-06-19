import { type ComponentRef, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
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

type RuntimeTab = 'hyper' | 'holesail' | 'p2pmd'

export default function App () {
  const workletRef = useRef<Worklet | null>(null)
  const rpcRef = useRef<RPC | null>(null)
  const p2pmdWebViewRef = useRef<ComponentRef<typeof WebView> | null>(null)
  const [isBooting, setIsBooting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('Starting Hyper runtime...')
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
      } else {
        setP2pmdRoom(null)
        setP2pmdUrl(null)
        setP2pmdParticipants(null)
        setP2pmdIsPreviewMode(false)
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
          setStatus('P2PMD document loaded')
          break
        case 'p2pmd-document-saved':
          setStatus(`P2PMD saved (${parsed.contentLength} characters)`)
          break
        case 'p2pmd-document-updated':
          setStatus(`P2PMD remote update received (${parsed.contentLength} characters)`)
          break
        case 'p2pmd-document-error':
          setStatus(parsed.error || 'P2PMD document request failed')
          break
        case 'p2pmd-preview-mode':
          setP2pmdIsPreviewMode(Boolean(parsed.preview))
          setStatus(parsed.preview ? 'P2PMD preview mode' : 'P2PMD write mode')
          break
        default:
          setStatus('P2PMD editor connected')
      }
    } catch {
      setStatus('P2PMD editor connected')
    }
  }

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
              <Text selectable={true} numberOfLines={1} style={styles.p2pmdWorkspaceKey}>
                {formatP2pmdRoomKey(p2pmdRoom.key)}
              </Text>
            </View>
            <Text selectable={true} numberOfLines={1} style={styles.p2pmdWorkspaceUrl}>
              {p2pmdRoom.localUrl}
            </Text>
          </View>
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
          source={{ uri: p2pmdUrl }}
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
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Runtime Check</Text>
        <View style={styles.tabRow}>
          <Pressable
            style={[styles.tabButton, activeTab === 'hyper' ? styles.tabButtonActive : null]}
            onPress={() => setActiveTab('hyper')}
            disabled={isBooting || isLoading}
          >
            <Text style={[styles.tabButtonText, activeTab === 'hyper' ? styles.tabButtonTextActive : null]}>
              Hyper
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabButton, activeTab === 'holesail' ? styles.tabButtonActive : null]}
            onPress={() => setActiveTab('holesail')}
            disabled={isBooting || isLoading}
          >
            <Text style={[styles.tabButtonText, activeTab === 'holesail' ? styles.tabButtonTextActive : null]}>
              Holesail
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabButton, activeTab === 'p2pmd' ? styles.tabButtonActive : null]}
            onPress={() => setActiveTab('p2pmd')}
            disabled={isBooting || isLoading}
          >
            <Text style={[styles.tabButtonText, activeTab === 'p2pmd' ? styles.tabButtonTextActive : null]}>
              P2PMD
            </Text>
          </Pressable>
        </View>
        <Text style={styles.status}>{status}</Text>

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
          <View style={[styles.section, styles.p2pmdSection]}>
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
              <View style={styles.emptyRoomCard}>
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
                    <Text style={styles.p2pmdActionHint}>Host from this phone</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.p2pmdSecondaryAction, isBooting || isLoading ? styles.p2pmdActionDisabled : null]}
                    onPress={() => void onP2pmdRoomRefresh()}
                    disabled={isBooting || isLoading}
                  >
                    <Text style={styles.p2pmdSecondaryActionText}>Refresh</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.joinRoomCard}>
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
    </SafeAreaView>
  )
}

function toBareFsPath (uri: string) {
  if (!uri.startsWith('file://')) return uri
  return decodeURIComponent(new URL(uri).pathname).replace(/\/$/, '')
}

function formatP2pmdRoomKey (key: string) {
  const readableKey = key.replace(/^hs:\/\//, '')
  if (readableKey.length <= 18) return `hs://${readableKey}`
  return `hs://${readableKey.slice(0, 8)}...${readableKey.slice(-6)}`
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  p2pmdWorkspace: {
    backgroundColor: '#1f2027',
    flex: 1
  },
  p2pmdWorkspaceHeader: {
    alignItems: 'center',
    backgroundColor: '#24262f',
    borderBottomColor: '#3a3d49',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  p2pmdWorkspaceTitle: {
    color: '#f1f2f7',
    fontSize: 18,
    fontWeight: '800'
  },
  p2pmdWorkspaceParticipants: {
    backgroundColor: '#30364a',
    borderRadius: 999,
    color: '#cdd6ff',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  p2pmdWorkspaceRole: {
    backgroundColor: '#3a3020',
    borderRadius: 999,
    color: '#ffd27a',
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    textTransform: 'uppercase'
  },
  p2pmdWorkspaceRoleHost: {
    backgroundColor: '#1d513d',
    color: '#c6f6df'
  },
  p2pmdPreviewButton: {
    backgroundColor: '#2f80ed',
    borderRadius: 12,
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  p2pmdPreviewButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7
  },
  p2pmdPreviewButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800'
  },
  p2pmdEyeIcon: {
    alignItems: 'center',
    borderColor: '#fff',
    borderRadius: 3,
    borderWidth: 2,
    height: 14,
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
    width: 14
  },
  p2pmdEyeIconDot: {
    backgroundColor: '#fff',
    borderRadius: 2,
    height: 4,
    transform: [{ rotate: '-45deg' }],
    width: 4
  },
  p2pmdPencilIcon: {
    height: 17,
    justifyContent: 'center',
    width: 17
  },
  p2pmdPencilBody: {
    backgroundColor: '#fff',
    borderRadius: 2,
    height: 3,
    left: 1,
    transform: [{ rotate: '-35deg' }],
    width: 14
  },
  p2pmdPencilTip: {
    backgroundColor: '#fff',
    height: 4,
    position: 'absolute',
    right: 1,
    top: 3,
    transform: [{ rotate: '-35deg' }],
    width: 3
  },
  p2pmdWorkspaceMeta: {
    alignItems: 'center',
    backgroundColor: '#202128',
    borderBottomColor: '#3a3d49',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  p2pmdRoomIdentity: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  p2pmdWorkspaceKeyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minWidth: 0
  },
  p2pmdWorkspaceKeyLabel: {
    backgroundColor: '#30364a',
    borderRadius: 6,
    color: '#cdd6ff',
    fontSize: 10,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    textTransform: 'uppercase'
  },
  p2pmdWorkspaceKey: {
    color: '#59a6ff',
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700'
  },
  p2pmdWorkspaceUrl: {
    color: '#a2a8bb',
    fontFamily: 'monospace',
    fontSize: 11
  },
  p2pmdMetaButton: {
    backgroundColor: '#30364a',
    borderColor: '#4c5675',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  p2pmdMetaButtonDanger: {
    backgroundColor: '#4a2730',
    borderColor: '#7c3b48'
  },
  p2pmdMetaButtonText: {
    color: '#f1f2f7',
    fontSize: 12,
    fontWeight: '800'
  },
  p2pmdWorkspaceWebView: {
    backgroundColor: '#202128',
    flex: 1
  },
  p2pmdWorkspaceLoader: {
    bottom: 12,
    position: 'absolute',
    right: 12
  },
  content: {
    gap: 12,
    padding: 16
  },
  title: {
    fontSize: 22,
    fontWeight: '700'
  },
  status: {
    fontSize: 14
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10
  },
  tabButton: {
    backgroundColor: '#f1f1f1',
    borderColor: '#d8d8d8',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  tabButtonActive: {
    backgroundColor: '#0f6fd4',
    borderColor: '#0f6fd4'
  },
  tabButtonText: {
    color: '#222',
    fontSize: 14,
    fontWeight: '600'
  },
  tabButtonTextActive: {
    color: '#fff'
  },
  input: {
    borderColor: '#bbb',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  section: {
    borderColor: '#ddd',
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 10
  },
  p2pmdSection: {
    backgroundColor: '#1f2027',
    borderColor: '#3a3d49',
    borderRadius: 14,
    padding: 12
  },
  p2pmdHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  p2pmdHeaderCopy: {
    flex: 1,
    gap: 4
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600'
  },
  p2pmdTitle: {
    color: '#f1f2f7'
  },
  helperText: {
    color: '#a2a8bb',
    fontSize: 13,
    lineHeight: 19
  },
  fieldLabel: {
    color: '#8c93a8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  p2pmdInput: {
    backgroundColor: '#262832',
    borderColor: '#3a3d49',
    color: '#f1f2f7'
  },
  result: {
    backgroundColor: '#f6f6f6',
    borderRadius: 8,
    padding: 10
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 12
  },
  emptyRoomCard: {
    backgroundColor: '#262832',
    borderColor: '#3a3d49',
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 12
  },
  emptyRoomTitle: {
    color: '#f1f2f7',
    fontSize: 15,
    fontWeight: '700'
  },
  p2pmdActionRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 6
  },
  p2pmdPrimaryAction: {
    backgroundColor: '#2f80ed',
    borderRadius: 12,
    flex: 1,
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  p2pmdPrimaryActionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800'
  },
  p2pmdActionHint: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '600'
  },
  p2pmdSecondaryAction: {
    alignItems: 'center',
    backgroundColor: '#30364a',
    borderColor: '#4c5675',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  p2pmdSecondaryActionText: {
    color: '#f1f2f7',
    fontSize: 13,
    fontWeight: '800'
  },
  p2pmdActionDisabled: {
    opacity: 0.5
  },
  joinRoomCard: {
    backgroundColor: '#22242c',
    borderColor: '#343744',
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  p2pmdJoinAction: {
    alignItems: 'center',
    backgroundColor: '#1d513d',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  p2pmdJoinActionText: {
    color: '#c6f6df',
    fontSize: 14,
    fontWeight: '800'
  },
  roomPill: {
    backgroundColor: '#30364a',
    borderRadius: 999,
    color: '#cdd6ff',
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  roomPillLive: {
    backgroundColor: '#2f80ed',
    color: '#fff'
  }
})
