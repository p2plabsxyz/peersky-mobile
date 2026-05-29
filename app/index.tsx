import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Button,
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

export default function App () {
  const workletRef = useRef<Worklet | null>(null)
  const rpcRef = useRef<RPC | null>(null)

  const [isBooting, setIsBooting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState('Starting Hyper runtime...')
  const [url, setUrl] = useState('hyper://localhost/')
  const [lastResult, setLastResult] = useState<RpcResponse | null>(null)

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

      const rpc = new RPC(worklet.IPC as unknown as any, () => {})

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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Hyper Runtime Check</Text>
        <Text style={styles.status}>{status}</Text>

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
