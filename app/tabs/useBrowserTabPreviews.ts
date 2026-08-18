import { type ComponentRef, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Directory, File, Paths } from 'expo-file-system'
import { captureRef, releaseCapture } from 'react-native-view-shot'
import {
  getBrowserTabPreviewFilename,
  isBrowserTabPreviewFilename,
  MAX_BROWSER_TAB_PREVIEW_FILE_BYTES,
  MAX_BROWSER_TAB_PREVIEW_FILES,
  parseBrowserTabPreviewFilename,
  selectRetainedBrowserTabPreviewUris
} from './browser-tab-preview.mjs'

type BrowserTabPreviewOptions<Entry> = {
  getEntryKey: (entry: Entry) => string
  isCurrentEntry: (tabId: string, entry: Entry) => boolean
}

export type BrowserTabPreview = {
  aspectRatio: number
  pageKey: string
  persistent: boolean
  uri: string
}

type RestorableBrowserTabPreview<Entry> = {
  entry: Entry
  tabId: string
}

const PREVIEW_CAPTURE_DELAY_MS = 200
const PREVIEW_CAPTURE_FAILURE_COOLDOWN_MS = 5000
const PREVIEW_CAPTURE_MIN_INTERVAL_MS = 1000
const PREVIEW_MAX_HEIGHT = 720
const PREVIEW_WIDTH = 360

type PendingCapture<Entry> = {
  entry: Entry
  epoch: number
  generation: number
}

export function useBrowserTabPreviews<Entry> ({
  getEntryKey,
  isCurrentEntry
}: BrowserTabPreviewOptions<Entry>) {
  const captureEpochRef = useRef(0)
  const captureFailureUntilRef = useRef(new Map<string, number>())
  const captureGenerationRef = useRef(new Map<string, number>())
  const captureInFlightRef = useRef(new Set<string>())
  const captureLastStartedAtRef = useRef(new Map<string, number>())
  const captureLayoutsRef = useRef(new Map<string, { height: number, width: number }>())
  const capturePendingRef = useRef(new Map<string, PendingCapture<Entry>>())
  const captureTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const captureViewRefs = useRef(new Map<string, ComponentRef<typeof View>>())
  const getEntryKeyRef = useRef(getEntryKey)
  const isCurrentEntryRef = useRef(isCurrentEntry)
  const mountedRef = useRef(true)
  const previewsRef = useRef(new Map<string, BrowserTabPreview>())
  const [previews, setPreviews] = useState(new Map<string, BrowserTabPreview>())

  getEntryKeyRef.current = getEntryKey
  isCurrentEntryRef.current = isCurrentEntry

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      captureEpochRef.current += 1
      for (const timer of captureTimersRef.current.values()) clearTimeout(timer)
      for (const preview of previewsRef.current.values()) {
        if (!preview.persistent) releaseTemporaryPreview(preview.uri)
      }
      captureFailureUntilRef.current.clear()
      captureGenerationRef.current.clear()
      captureInFlightRef.current.clear()
      captureLastStartedAtRef.current.clear()
      captureTimersRef.current.clear()
      captureLayoutsRef.current.clear()
      capturePendingRef.current.clear()
      captureViewRefs.current.clear()
      previewsRef.current.clear()
    }
  }, [])

  function schedulePreview (
    tabId: string,
    expectedEntry: Entry,
    delay = PREVIEW_CAPTURE_DELAY_MS
  ) {
    const epoch = captureEpochRef.current
    const generation = (captureGenerationRef.current.get(tabId) || 0) + 1
    captureGenerationRef.current.set(tabId, generation)
    const pendingCapture = { entry: expectedEntry, epoch, generation }

    if (captureInFlightRef.current.has(tabId)) {
      capturePendingRef.current.set(tabId, pendingCapture)
      return
    }

    queueCapture(tabId, pendingCapture, delay)
  }

  function queueCapture (
    tabId: string,
    pendingCapture: PendingCapture<Entry>,
    delay: number
  ) {
    const pendingTimer = captureTimersRef.current.get(tabId)
    if (pendingTimer) clearTimeout(pendingTimer)

    const now = Date.now()
    const nextAllowedAt = Math.max(
      captureFailureUntilRef.current.get(tabId) || 0,
      (captureLastStartedAtRef.current.get(tabId) || 0) +
        PREVIEW_CAPTURE_MIN_INTERVAL_MS
    )
    const wait = Math.max(0, delay, nextAllowedAt - now)
    const timer = setTimeout(() => {
      captureTimersRef.current.delete(tabId)
      void capturePreview(tabId, pendingCapture)
    }, wait)
    captureTimersRef.current.set(tabId, timer)
  }

  async function capturePreview (
    tabId: string,
    pendingCapture: PendingCapture<Entry>
  ) {
    const { entry: expectedEntry, epoch, generation } = pendingCapture
    if (
      !mountedRef.current ||
      epoch !== captureEpochRef.current ||
      generation !== captureGenerationRef.current.get(tabId) ||
      !isCurrentEntryRef.current(tabId, expectedEntry)
    ) return

    const previewView = captureViewRefs.current.get(tabId)
    const layout = captureLayoutsRef.current.get(tabId)
    if (!previewView || !layout) return
    const previewHeight = Math.min(
      PREVIEW_MAX_HEIGHT,
      Math.max(1, Math.round(PREVIEW_WIDTH * layout.height / layout.width))
    )

    captureInFlightRef.current.add(tabId)
    captureLastStartedAtRef.current.set(tabId, Date.now())

    try {
      const temporaryUri = await captureRef(previewView, {
        format: 'jpg',
        height: previewHeight,
        quality: 0.6,
        result: 'tmpfile',
        width: PREVIEW_WIDTH
      })
      const isCurrentCapture =
        mountedRef.current &&
        epoch === captureEpochRef.current &&
        generation === captureGenerationRef.current.get(tabId) &&
        isCurrentEntryRef.current(tabId, expectedEntry)

      if (!isCurrentCapture) {
        releaseTemporaryPreview(temporaryUri)
        return
      }

      const persisted = persistPreview({
        aspectRatio: PREVIEW_WIDTH / previewHeight,
        height: previewHeight,
        pageKey: getEntryKeyRef.current(expectedEntry),
        revision: Date.now() * 100 + generation,
        tabId,
        temporaryUri,
        width: PREVIEW_WIDTH
      })
      if (!persisted) return

      captureFailureUntilRef.current.delete(tabId)
      const previousPreview = previewsRef.current.get(tabId)
      if (previousPreview && previousPreview.uri !== persisted.preview.uri) {
        deletePreview(previousPreview)
      }

      const nextPreviews = new Map(previewsRef.current)
      for (const [previewTabId, preview] of nextPreviews) {
        if (persisted.deletedUris.has(preview.uri)) {
          nextPreviews.delete(previewTabId)
        }
      }
      nextPreviews.set(tabId, persisted.preview)
      previewsRef.current = nextPreviews
      setPreviews(nextPreviews)
    } catch (error) {
      captureFailureUntilRef.current.set(
        tabId,
        Date.now() + PREVIEW_CAPTURE_FAILURE_COOLDOWN_MS
      )
      console.warn(`Failed capturing preview for browser tab ${tabId}:`, error)
    } finally {
      captureInFlightRef.current.delete(tabId)
      const queuedCapture = capturePendingRef.current.get(tabId)
      capturePendingRef.current.delete(tabId)
      if (
        queuedCapture &&
        mountedRef.current &&
        queuedCapture.epoch === captureEpochRef.current &&
        queuedCapture.generation === captureGenerationRef.current.get(tabId)
      ) {
        queueCapture(tabId, queuedCapture, 0)
      }
    }
  }

  function clearPreview (tabId: string) {
    const pendingTimer = captureTimersRef.current.get(tabId)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      captureTimersRef.current.delete(tabId)
    }
    captureFailureUntilRef.current.delete(tabId)
    captureLastStartedAtRef.current.delete(tabId)
    capturePendingRef.current.delete(tabId)
    captureGenerationRef.current.set(
      tabId,
      (captureGenerationRef.current.get(tabId) || 0) + 1
    )

    const preview = previewsRef.current.get(tabId)
    if (!preview) return

    deletePreview(preview)
    const nextPreviews = new Map(previewsRef.current)
    nextPreviews.delete(tabId)
    previewsRef.current = nextPreviews
    setPreviews(nextPreviews)
  }

  function clearCachedPreviews () {
    captureEpochRef.current += 1
    for (const timer of captureTimersRef.current.values()) clearTimeout(timer)
    for (const preview of previewsRef.current.values()) {
      if (!preview.persistent) releaseTemporaryPreview(preview.uri)
    }
    const cacheCleared = deletePreviewDirectory()
    captureFailureUntilRef.current.clear()
    captureTimersRef.current.clear()
    captureGenerationRef.current.clear()
    captureLastStartedAtRef.current.clear()
    capturePendingRef.current.clear()
    previewsRef.current = new Map()
    setPreviews(new Map())
    return cacheCleared
  }

  function clearAllPreviews () {
    const cacheCleared = clearCachedPreviews()
    captureLayoutsRef.current.clear()
    captureViewRefs.current.clear()
    return cacheCleared
  }

  function removePreview (tabId: string) {
    clearPreview(tabId)
    captureFailureUntilRef.current.delete(tabId)
    captureLayoutsRef.current.delete(tabId)
    captureLastStartedAtRef.current.delete(tabId)
    capturePendingRef.current.delete(tabId)
    captureViewRefs.current.delete(tabId)
  }

  function restorePreviews (tabs: RestorableBrowserTabPreview<Entry>[]) {
    const nextPreviews = new Map<string, BrowserTabPreview>()
    try {
      const directory = getPreviewDirectory()
      if (!directory.exists) return

      const allFiles = directory.list()
        .filter((entry): entry is File => entry instanceof File)
      const selectedCandidates = tabs
        .slice(0, MAX_BROWSER_TAB_PREVIEW_FILES)
        .flatMap((tab) => {
          const pageKey = getEntryKeyRef.current(tab.entry)
          const selected = allFiles
            .map((file) => ({
              file,
              pageKey,
              parsed: parseBrowserTabPreviewFilename(file.name, tab.tabId, pageKey),
              tabId: tab.tabId
            }))
            .filter(({ file, parsed }) =>
              parsed &&
              file.size > 0 &&
              file.size <= MAX_BROWSER_TAB_PREVIEW_FILE_BYTES
            )
            .sort((left, right) =>
              (right.file.modificationTime || 0) -
              (left.file.modificationTime || 0)
            )[0]

          return selected ? [selected] : []
        })
      const retainedUris = selectRetainedBrowserTabPreviewUris(
        selectedCandidates.map(({ file }) => toPreviewFileMetadata(file))
      )

      for (const selected of selectedCandidates) {
        if (!selected.parsed || !retainedUris.has(selected.file.uri)) continue

        nextPreviews.set(selected.tabId, {
          aspectRatio: selected.parsed.aspectRatio,
          pageKey: selected.pageKey,
          persistent: true,
          uri: selected.file.uri
        })
      }

      for (const file of allFiles) {
        if (!retainedUris.has(file.uri)) deleteFile(file)
      }
    } catch (error) {
      console.warn('Failed restoring browser tab previews:', error)
    }

    if (!mountedRef.current) return
    previewsRef.current = nextPreviews
    setPreviews(nextPreviews)
  }

  function setCaptureLayout (tabId: string, width: number, height: number) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) return

    captureLayoutsRef.current.set(tabId, { width, height })
  }

  function setCaptureView (tabId: string, view: ComponentRef<typeof View> | null) {
    if (view) {
      captureViewRefs.current.set(tabId, view)
    } else {
      captureViewRefs.current.delete(tabId)
    }
  }

  return {
    clearAllPreviews,
    clearCachedPreviews,
    clearPreview,
    previews,
    removePreview,
    restorePreviews,
    schedulePreview,
    setCaptureLayout,
    setCaptureView
  }
}

function getPreviewDirectory () {
  return new Directory(Paths.cache, 'browser-tab-previews')
}

function persistPreview ({
  aspectRatio,
  height,
  pageKey,
  revision,
  tabId,
  temporaryUri,
  width
}: {
  aspectRatio: number
  height: number
  pageKey: string
  revision: number
  tabId: string
  temporaryUri: string
  width: number
}): {
  deletedUris: Set<string>
  preview: BrowserTabPreview
} | null {
  let destination: File
  let directory: Directory

  try {
    const filename = getBrowserTabPreviewFilename(
      tabId,
      pageKey,
      revision,
      width,
      height
    )
    if (!filename) throw new Error('Invalid tab preview filename')

    directory = getPreviewDirectory()
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
    destination = new File(directory, filename)
    if (destination.exists) destination.delete()
    new File(temporaryUri).move(destination)
  } catch (error) {
    console.warn(`Failed persisting preview for browser tab ${tabId}:`, error)
    return {
      deletedUris: new Set(),
      preview: {
        aspectRatio,
        pageKey,
        persistent: false,
        uri: temporaryUri
      }
    }
  }

  const destinationMetadata = readPreviewFileMetadata(destination)
  if (
    !destinationMetadata ||
    destinationMetadata.size < 1 ||
    destinationMetadata.size > MAX_BROWSER_TAB_PREVIEW_FILE_BYTES
  ) {
    deleteFile(destination)
    return null
  }

  const deletedUris = new Set<string>()
  try {
    const files = directory.list()
      .filter((entry): entry is File => entry instanceof File)

    for (const entry of files) {
      if (
        entry.uri !== destination.uri &&
        isBrowserTabPreviewFilename(entry.name) &&
        entry.name.startsWith(`preview-${tabId}-`) &&
        deleteFile(entry)
      ) {
        deletedUris.add(entry.uri)
      }
    }

    const remainingFiles = directory.list()
      .filter((entry): entry is File => entry instanceof File)
    const retainedUris = selectRetainedBrowserTabPreviewUris(
      remainingFiles.map((file) =>
        toPreviewFileMetadata(
          file,
          file.uri === destination.uri ? Date.now() : undefined
        )
      )
    )

    for (const file of remainingFiles) {
      if (!retainedUris.has(file.uri) && deleteFile(file)) {
        deletedUris.add(file.uri)
      }
    }
  } catch (error) {
    console.warn(`Failed pruning previews for browser tab ${tabId}:`, error)
  }

  try {
    if (!destination.exists) return null
  } catch (error) {
    console.warn(`Failed checking preview for browser tab ${tabId}:`, error)
    return null
  }

  return {
    deletedUris,
    preview: {
      aspectRatio,
      pageKey,
      persistent: true,
      uri: destination.uri
    }
  }
}

function deletePreview (preview: BrowserTabPreview) {
  if (preview.persistent) {
    deleteFile(new File(preview.uri))
  } else {
    releaseTemporaryPreview(preview.uri)
  }
}

function deletePreviewDirectory () {
  try {
    const directory = getPreviewDirectory()
    if (directory.exists) directory.delete()
    return true
  } catch (error) {
    console.warn('Failed clearing browser tab preview cache:', error)
    return false
  }
}

function deleteFile (file: File) {
  try {
    if (file.exists) file.delete()
    return true
  } catch (error) {
    console.warn('Failed deleting browser tab preview:', error)
    return false
  }
}

function toPreviewFileMetadata (file: File, modificationTime = file.modificationTime) {
  return {
    modificationTime,
    name: file.name,
    size: file.size,
    uri: file.uri
  }
}

function readPreviewFileMetadata (file: File) {
  try {
    return toPreviewFileMetadata(file)
  } catch (error) {
    console.warn('Failed reading browser tab preview metadata:', error)
    return null
  }
}

function releaseTemporaryPreview (uri: string) {
  try {
    releaseCapture(uri)
  } catch (error) {
    console.warn('Failed releasing browser tab preview:', error)
  }
}
