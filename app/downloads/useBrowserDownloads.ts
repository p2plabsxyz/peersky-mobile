import { useCallback, useEffect, useRef, useState } from 'react'
import CookieManager from '@preeternal/react-native-cookie-manager'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { NativeModules, Platform } from 'react-native'
import { recordBrowserDiagnostic } from '../browser-diagnostics.mjs'
import {
  addDownloadUrlFingerprint,
  createUniqueDownloadFilename,
  normalizeBrowserDownloads,
  normalizeBrowserDownloadUrl
} from './browser-downloads.mjs'

export type BrowserDownload = {
  id: string
  name: string
  status: 'pending' | 'running' | 'paused' | 'complete' | 'failed'
  size: number
  downloadedBytes?: number
  totalBytes?: number
  createdAt: number
  reason?: string
  sourceUrl?: string
}

type BrowserDownloadsNativeModule = {
  getDownloads: () => Promise<BrowserDownload[]>
  openDownload: (id: string) => Promise<boolean>
  openLocalFile: (uri: string, name?: string) => Promise<boolean>
  removeDownload: (id: string) => Promise<boolean>
  pauseDownload: (id: string) => Promise<boolean>
  resumeDownload: (id: string, url: string) => Promise<boolean>
  requestDownload: (url: string) => Promise<boolean>
}

const androidDownloads = NativeModules.BrowserDownloads as BrowserDownloadsNativeModule | undefined
const MAX_CONCURRENT_IOS_DOWNLOADS = 3
const DOWNLOAD_POLL_INTERVAL_MS = 1500

export function useBrowserDownloads ({ enabled = false } = {}) {
  const [downloads, setDownloads] = useState<BrowserDownload[]>([])
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeIosDownloads = useRef(new Set<string>())
  const refreshSequence = useRef(0)
  const lastDiagnosticState = useRef('')

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    try {
      const records = Platform.OS === 'android'
        ? await getAndroidDownloads().getDownloads()
        : listIosDownloads()
      const normalized = normalizeBrowserDownloads(records) as BrowserDownload[]
      if (sequence !== refreshSequence.current) return normalized

      setDownloads(normalized)
      const diagnosticState = normalized.map(({ id, status, reason }) => `${id}:${status}:${reason || ''}`).join('|')
      if (diagnosticState !== lastDiagnosticState.current) {
        lastDiagnosticState.current = diagnosticState
        recordBrowserDiagnostic('downloads', 'status-change', {
          downloads: normalized.map(({ id, name, status, size, reason, sourceUrl }) => ({
            id,
            name,
            status,
            size,
            reason,
            sourceUrl
          }))
        })
      }
      setError(null)
      return normalized
    } catch (refreshError) {
      if (sequence !== refreshSequence.current) return []
      console.error('Failed loading browser downloads:', refreshError)
      setError('Unable to load downloads.')
      return []
    } finally {
      if (sequence === refreshSequence.current) setIsReady(true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const poll = async () => {
      const records = await refresh()
      if (cancelled || !hasActiveDownload(records)) return
      pollTimer = setTimeout(() => void poll(), DOWNLOAD_POLL_INTERVAL_MS)
    }

    void poll()
    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [enabled, refresh])

  async function requestDownload (url: string) {
    const normalizedUrl = normalizeBrowserDownloadUrl(url)
    if (!normalizedUrl) {
      setError('This download URL is not supported.')
      return false
    }

    if (Platform.OS === 'android') {
      try {
        const accepted = await getAndroidDownloads().requestDownload(normalizedUrl)
        setError(accepted ? null : 'Unable to start this download.')
        return accepted
      } catch (downloadError) {
        console.error('Failed requesting Android download:', downloadError)
        setError('Unable to start this download.')
        return false
      }
    }

    if (activeIosDownloads.current.has(normalizedUrl)) return false
    if (activeIosDownloads.current.size >= MAX_CONCURRENT_IOS_DOWNLOADS) {
      setError('Too many downloads are already running.')
      return false
    }

    activeIosDownloads.current.add(normalizedUrl)
    const stagingDirectory = getIosDownloadStagingDirectory()
    try {
      const cookieHeader = await CookieManager.getCookieHeader(normalizedUrl, true)
      stagingDirectory.create({ intermediates: true, idempotent: true })
      const stagedFile = await File.downloadFileAsync(normalizedUrl, stagingDirectory, {
        headers: cookieHeader ? { Cookie: cookieHeader } : undefined
      })
      const savedFile = moveIosDownloadIntoPlace(stagedFile, normalizedUrl)
      persistIosDownloadSource(savedFile.uri, normalizedUrl)
      await refresh()
      return true
    } catch (downloadError) {
      console.error('Failed downloading file:', downloadError)
      setError('Unable to download this file.')
      return false
    } finally {
      if (stagingDirectory.exists) stagingDirectory.delete()
      activeIosDownloads.current.delete(normalizedUrl)
    }
  }

  async function removeDownload (id: string) {
    try {
      if (Platform.OS === 'android') {
        if (!await getAndroidDownloads().removeDownload(id)) {
          throw new Error('Download was not removed')
        }
      } else {
        const file = new File(id)
        if (file.exists) file.delete()
        removeIosDownloadSource(id)
      }
      await refresh()
      return true
    } catch (removeError) {
      console.error('Failed removing browser download:', removeError)
      setError('Unable to remove this download.')
      return false
    }
  }

  async function pauseDownload (download: BrowserDownload) {
    if (
      Platform.OS !== 'android' ||
      !download.id.startsWith('r:') ||
      !['pending', 'running'].includes(download.status)
    ) {
      setError('This download cannot be paused.')
      return false
    }

    try {
      const paused = await getAndroidDownloads().pauseDownload(download.id)
      if (!paused) throw new Error('Download was not paused')
      recordBrowserDiagnostic('downloads', 'user-paused', { id: download.id, name: download.name })
      await refresh()
      return true
    } catch (pauseError) {
      console.error('Failed pausing browser download:', pauseError)
      setError('Unable to pause this download.')
      return false
    }
  }

  async function openDownload (id: string) {
    try {
      if (Platform.OS === 'android') {
        if (!await getAndroidDownloads().openDownload(id)) {
          throw new Error('Download could not be opened')
        }
      } else {
        if (!await Sharing.isAvailableAsync()) {
          throw new Error('Native file sharing is unavailable')
        }
        await Sharing.shareAsync(id)
      }
      setError(null)
      return true
    } catch (openError) {
      console.error('Failed opening browser download:', openError)
      setError('No app is available to open this download.')
      return false
    }
  }

  async function openLocalFile (uri: string, name?: string) {
    if (Platform.OS !== 'android') {
      if (!await Sharing.isAvailableAsync()) return false
      await Sharing.shareAsync(uri)
      return true
    }

    try {
      const opened = await getAndroidDownloads().openLocalFile(uri, name)
      setError(opened ? null : 'No app is available to open this file.')
      return opened
    } catch (openError) {
      console.error('Failed opening local file:', openError)
      setError('No app is available to open this file.')
      return false
    }
  }

  async function retryDownload (download: BrowserDownload, sourceUrl = download.sourceUrl) {
    const normalizedUrl = normalizeBrowserDownloadUrl(sourceUrl)
    if (!['failed', 'paused'].includes(download.status) || !normalizedUrl) {
      setError('This download cannot be retried.')
      return false
    }

    if (
      Platform.OS === 'android' &&
      download.id.startsWith('r:') &&
      (
        download.status === 'paused' ||
        (
          download.status === 'failed' &&
          (download.downloadedBytes || 0) > 0 &&
          ['network-error', 'incomplete-response'].includes(download.reason || '')
        )
      )
    ) {
      try {
        const resumed = await getAndroidDownloads().resumeDownload(download.id, normalizedUrl)
        if (!resumed) throw new Error('Download was not resumed')
        recordBrowserDiagnostic('downloads', 'user-resumed', {
          id: download.id,
          name: download.name,
          downloadedBytes: download.downloadedBytes || 0
        })
        await refresh()
        setError(null)
        return true
      } catch (resumeError) {
        console.error('Failed resuming browser download:', resumeError)
        setError('Unable to resume this download.')
        return false
      }
    }

    const accepted = await requestDownload(normalizedUrl)
    if (!accepted) return false

    await removeDownload(download.id)
    setError(null)
    return true
  }

  return {
    downloads,
    error,
    isReady,
    openLocalFile,
    openDownload,
    pauseDownload,
    refresh,
    removeDownload,
    requestDownload,
    retryDownload
  }
}

function getAndroidDownloads () {
  if (!androidDownloads) {
    throw new Error('BrowserDownloads native module is unavailable')
  }
  return androidDownloads
}

function getIosDownloadsDirectory () {
  return new Directory(Paths.document, 'browser-downloads')
}

function getIosDownloadStagingDirectory () {
  return new Directory(
    Paths.cache,
    'browser-download-staging',
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
}

function moveIosDownloadIntoPlace (stagedFile: File, sourceUrl: string) {
  const directory = getIosDownloadsDirectory()
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
  const existingNames = directory.list()
    .filter((entry): entry is File => entry instanceof File)
    .map((entry) => entry.name)
  const sourceName = addDownloadUrlFingerprint(stagedFile.name, sourceUrl)
  const destinationName = createUniqueDownloadFilename(sourceName, existingNames)
  const destination = new File(directory, destinationName)
  stagedFile.move(destination)
  return destination
}

function listIosDownloads (): BrowserDownload[] {
  const directory = getIosDownloadsDirectory()
  if (!directory.exists) return []
  const sources = loadIosDownloadSources()

  return directory.list().flatMap((entry) => {
    if (!(entry instanceof File)) return []

    return [{
      id: entry.uri,
      name: entry.name,
      status: 'complete' as const,
      size: entry.size,
      createdAt: entry.creationTime || entry.modificationTime || 0,
      sourceUrl: sources[entry.uri]
    }]
  })
}

const IOS_DOWNLOAD_SOURCES_FILE = new File(Paths.document, 'browser-download-sources.json')
const MAX_IOS_DOWNLOAD_SOURCES_BYTES = 128 * 1024

function loadIosDownloadSources (): Record<string, string> {
  try {
    if (!IOS_DOWNLOAD_SOURCES_FILE.exists || IOS_DOWNLOAD_SOURCES_FILE.size > MAX_IOS_DOWNLOAD_SOURCES_BYTES) return {}
    const parsed = JSON.parse(IOS_DOWNLOAD_SOURCES_FILE.textSync())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return Object.fromEntries(Object.entries(parsed).flatMap(([uri, sourceUrl]) => {
      const normalizedUrl = normalizeBrowserDownloadUrl(sourceUrl)
      return uri.startsWith(getIosDownloadsDirectory().uri) && normalizedUrl
        ? [[uri, normalizedUrl]]
        : []
    }).slice(0, 200))
  } catch {
    return {}
  }
}

function persistIosDownloadSource (uri: string, sourceUrl: string) {
  try {
    const sources = Object.fromEntries([
      [uri, sourceUrl],
      ...Object.entries(loadIosDownloadSources()).filter(([storedUri]) => storedUri !== uri)
    ].slice(0, 200))
    if (!IOS_DOWNLOAD_SOURCES_FILE.exists) IOS_DOWNLOAD_SOURCES_FILE.create({ intermediates: true })
    IOS_DOWNLOAD_SOURCES_FILE.write(JSON.stringify(sources))
  } catch (error) {
    console.warn('Unable to persist iOS download source:', error)
  }
}

function removeIosDownloadSource (uri: string) {
  try {
    const sources = loadIosDownloadSources()
    delete sources[uri]
    if (!IOS_DOWNLOAD_SOURCES_FILE.exists) return
    IOS_DOWNLOAD_SOURCES_FILE.write(JSON.stringify(sources))
  } catch (error) {
    console.warn('Unable to update iOS download sources:', error)
  }
}

function hasActiveDownload (downloads: BrowserDownload[]) {
  return downloads.some(({ status, reason }) =>
    status === 'pending' || status === 'running' || (status === 'paused' && reason !== 'user-paused')
  )
}
