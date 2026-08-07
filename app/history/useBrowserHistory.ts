import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import { AppState } from 'react-native'
import {
  addBrowserHistoryItem,
  getBrowserHistorySuggestions,
  mergeBrowserHistoryItems,
  removeBrowserHistoryItem,
  serializeBrowserHistory
} from './browser-history.mjs'
import {
  readBrowserHistoryFile,
  replaceBrowserHistoryFile
} from './browser-history-storage.mjs'

export type BrowserHistoryItem = {
  url: string
  title: string
  visitedAt: number
}

export function useBrowserHistory () {
  const [items, setItems] = useState<BrowserHistoryItem[]>([])
  const itemsRef = useRef(items)
  const pendingItemsRef = useRef<BrowserHistoryItem[]>([])
  const pendingWriteRef = useRef<BrowserHistoryItem[] | null>(null)
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readyRef = useRef(false)
  const mountedRef = useRef(true)
  const [isReady, setIsReady] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory () {
      try {
        const stored = await loadStoredHistory()
        const pendingItems = pendingItemsRef.current
        const restored = mergeBrowserHistoryItems(stored.items, pendingItems) as BrowserHistoryItem[]

        if (cancelled) return
        itemsRef.current = restored
        pendingItemsRef.current = []
        setItems(restored)
        readyRef.current = true
        setIsReady(true)
        setPersistenceError(stored.warning)

        if (pendingItems.length > 0 || stored.warning) {
          scheduleHistoryWrite(restored)
        }
      } catch (error) {
        console.error('Failed loading browser history:', error)
        if (!cancelled) {
          let pendingHistory: BrowserHistoryItem[] = []
          for (const pending of pendingItemsRef.current) {
            pendingHistory = addBrowserHistoryItem(pendingHistory, pending) as BrowserHistoryItem[]
          }
          itemsRef.current = pendingHistory
          pendingItemsRef.current = []
          setItems(pendingHistory)
          readyRef.current = true
          setIsReady(true)
          setPersistenceError('Unable to load browser history.')
        }
      }
    }

    void loadHistory()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') flushPendingHistory()
    })

    return () => {
      subscription.remove()
      mountedRef.current = false
      flushPendingHistory()
    }
  }, [])

  function persistItems (nextItems: BrowserHistoryItem[], immediate = false) {
    if (!readyRef.current) {
      setPersistenceError('Browser history is still loading. Try again in a moment.')
      return false
    }

    itemsRef.current = nextItems
    setItems(nextItems)
    setPersistenceError(null)
    pendingWriteRef.current = nextItems

    if (immediate) return flushPendingHistory()
    scheduleHistoryWrite(nextItems)
    return true
  }

  function scheduleHistoryWrite (nextItems: BrowserHistoryItem[]) {
    pendingWriteRef.current = nextItems
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current)
    writeTimerRef.current = setTimeout(flushPendingHistory, 300)
  }

  function flushPendingHistory () {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current)
      writeTimerRef.current = null
    }

    const pendingItems = pendingWriteRef.current
    if (!pendingItems) return true

    try {
      writeHistory(pendingItems)
      pendingWriteRef.current = null
      if (mountedRef.current) setPersistenceError(null)
      return true
    } catch (error) {
      console.error('Failed saving browser history:', error)
      if (mountedRef.current) {
        setPersistenceError('Unable to save browser history. Changes may be lost after restart.')
      }
      return false
    }
  }

  return {
    items,
    isReady,
    persistenceError,
    clearHistory: () => persistItems([], true),
    getSuggestions: (query: string) => getBrowserHistorySuggestions(itemsRef.current, query) as BrowserHistoryItem[],
    recordVisit: ({
      url,
      title,
      visitedAt = Date.now()
    }: {
      url: string
      title: string
      visitedAt?: number
    }) => {
      const nextItems = addBrowserHistoryItem(itemsRef.current, { url, title, visitedAt }) as BrowserHistoryItem[]
      if (nextItems === itemsRef.current) return false

      if (!readyRef.current) {
        pendingItemsRef.current.push({ url, title, visitedAt })
        return true
      }

      return persistItems(nextItems)
    },
    removeHistoryItem: (item: BrowserHistoryItem) => {
      const nextItems = removeBrowserHistoryItem(itemsRef.current, item) as BrowserHistoryItem[]
      return nextItems === itemsRef.current || persistItems(nextItems, true)
    }
  }
}

function getHistoryFiles () {
  return {
    active: new File(Paths.document, 'browser-history.json'),
    backup: new File(Paths.document, 'browser-history.json.backup'),
    temporary: new File(Paths.document, 'browser-history.json.temporary')
  }
}

async function loadStoredHistory () {
  const files = getHistoryFiles()
  const active = await readBrowserHistoryFile(files.active)
  if (active.ok && active.exists) {
    return { items: active.items as BrowserHistoryItem[], warning: null }
  }

  for (const candidate of [files.backup, files.temporary]) {
    const recovered = await readBrowserHistoryFile(candidate)
    if (recovered.ok && recovered.exists) {
      return {
        items: recovered.items as BrowserHistoryItem[],
        warning: 'Browser history was recovered after an interrupted save.'
      }
    }
  }

  if (active.ok) return { items: [] as BrowserHistoryItem[], warning: null }
  throw new Error(active.error || 'Unable to load browser history.')
}

function writeHistory (items: BrowserHistoryItem[]) {
  const files = getHistoryFiles()
  replaceBrowserHistoryFile({
    activeUri: files.active.uri,
    backupUri: files.backup.uri,
    temporaryUri: files.temporary.uri,
    createFile: (uri: string) => new File(uri)
  }, serializeBrowserHistory(items))
}
