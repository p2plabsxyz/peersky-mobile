import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
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
  const [p2pmdBridgeMessage, setP2pmdBridgeMessage] = useState('')

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
    setP2pmdBridgeMessage('')

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
    setP2pmdBridgeMessage('')

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

  async function onP2pmdRoomStatus () {
    setIsLoading(true)
    setStatus('Reading P2PMD room status...')
    setLastResult(null)

    try {
      const response = await callRpc(RPC_P2PMD_ROOM_STATUS, {})
      setLastResult(response)

      if (response.running && response.room) {
        setP2pmdRoom(response.room)
        setP2pmdUrl(response.room.localUrl)
      } else {
        setP2pmdRoom(null)
        setP2pmdUrl(null)
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
      setP2pmdBridgeMessage('')
      setStatus(response.ok ? 'P2PMD room disconnected' : (response.error || 'Failed disconnecting P2PMD room'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
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
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>P2PMD Local Document Check</Text>
            <View style={styles.buttons}>
              <Button
                title='Create Room'
                onPress={() => void onP2pmdRoomCreate()}
                disabled={isBooting || isLoading}
              />
              <Button
                title='Room Status'
                onPress={() => void onP2pmdRoomStatus()}
                disabled={isBooting || isLoading}
              />
              <Button
                title='Disconnect'
                onPress={() => void onP2pmdRoomDisconnect()}
                disabled={isBooting || isLoading}
              />
            </View>

            <View style={styles.joinRoom}>
              <TextInput
                style={styles.input}
                autoCapitalize='none'
                autoCorrect={false}
                value={p2pmdJoinKey}
                onChangeText={setP2pmdJoinKey}
                placeholder='hs://... room key'
              />
              <Button
                title='Join Room'
                onPress={() => void onP2pmdRoomJoin()}
                disabled={isBooting || isLoading || !p2pmdJoinKey.trim()}
              />
            </View>

            {p2pmdRoom && (
              <View style={styles.roomDetails}>
                <Text style={styles.roomLabel}>Role: {p2pmdRoom.role}</Text>
                <Text selectable={true} style={styles.roomKey}>
                  {p2pmdRoom.key}
                </Text>
                <Text selectable={true} style={styles.roomUrl}>
                  {p2pmdRoom.localUrl}
                </Text>
              </View>
            )}

            {p2pmdUrl && (
              <View style={styles.webViewFrame}>
                <WebView
                  source={{ uri: p2pmdUrl }}
                  onMessage={(event) => {
                    const message = event.nativeEvent.data
                    setP2pmdBridgeMessage(message)

                    try {
                      const parsed = JSON.parse(message)

                      if (parsed.type === 'p2pmd-document-loaded') {
                        setStatus('P2PMD document loaded from Bare server')
                      } else if (parsed.type === 'p2pmd-document-saved') {
                        setStatus(`P2PMD document saved (${parsed.contentLength} characters)`)
                      } else if (parsed.type === 'p2pmd-document-error') {
                        setStatus(parsed.error || 'P2PMD document request failed')
                      } else {
                        setStatus('P2PMD WebView connected to Bare server')
                      }
                    } catch {
                      setStatus('P2PMD WebView connected to Bare server')
                    }
                  }}
                  onError={(event) => {
                    setStatus(`P2PMD WebView failed: ${event.nativeEvent.description}`)
                  }}
                  onLoad={() => {
                    if (p2pmdRoom?.role === 'client') {
                      setStatus('P2PMD joined room page loaded')
                    }
                  }}
                />
              </View>
            )}

            {p2pmdBridgeMessage && (
              <Text selectable={true} style={styles.bridgeMessage}>
                WebView bridge: {p2pmdBridgeMessage}
              </Text>
            )}
          </View>
        )}

        {(isBooting || isLoading) && <ActivityIndicator size='small' />}

        {lastResult && (
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

const styles = StyleSheet.create({
  container: {
    flex: 1
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600'
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
  webViewFrame: {
    borderColor: '#bbb',
    borderRadius: 8,
    borderWidth: 1,
    height: 280,
    overflow: 'hidden'
  },
  bridgeMessage: {
    color: '#076c50',
    fontFamily: 'monospace',
    fontSize: 12
  },
  roomDetails: {
    gap: 6
  },
  joinRoom: {
    gap: 10
  },
  roomLabel: {
    fontSize: 14,
    fontWeight: '600'
  },
  roomKey: {
    color: '#076c50',
    fontFamily: 'monospace',
    fontSize: 12
  },
  roomUrl: {
    color: '#526158',
    fontFamily: 'monospace',
    fontSize: 12
  }
})
