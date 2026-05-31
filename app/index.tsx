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
import bundle from './app.bundle.mjs'
import {
  RPC_HOLESAIL_CONNECT,
  RPC_HOLESAIL_START_LIVE,
  RPC_HOLESAIL_STATUS,
  RPC_HOLESAIL_STOP,
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT
} from '../backend/rpc/commands.mjs'

type RpcResponse = {
  ok: boolean
  error?: string
  status?: number
  statusText?: string
  url?: string
  body?: string
  storagePath?: string
  headers?: Record<string, string>
}

type RuntimeTab = 'hyper' | 'holesail'

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
  }
})
