import { useCallback, useEffect, useRef, useState } from 'react'
import CookieManager from '@preeternal/react-native-cookie-manager'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { NativeModules, Platform } from 'react-native'
import {
  createUniqueDownloadFilename,
  normalizeBrowserDownloads,
  normalizeBrowserDownloadUrl
} from './browser-downloads.mjs'

export type BrowserDownload = {
  id: string
  name: string
  status: 'pending' | 'running' | 'paused' | 'complete' | 'failed'
  size: number
  createdAt: number
}

type BrowserDownloadsNativeModule = {
  getDownloads: () => Promise<BrowserDownload[]>
  openDownload: (id: string) => Promise<boolean>
  removeDownload: (id: string) => Promise<boolean>
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

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    try {
      const records = Platform.OS === 'android'
        ? await getAndroidDownloads().getDownloads()
        : listIosDownloads()
      const normalized = normalizeBrowserDownloads(records) as BrowserDownload[]
      if (sequence !== refreshSequence.current) return normalized

      setDownloads(normalized)
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
    if (Platform.OS === 'android') return

    const normalizedUrl = normalizeBrowserDownloadUrl(url)
    if (!normalizedUrl) {
      setError('This download URL is not supported.')
      return
    }
    if (activeIosDownloads.current.has(normalizedUrl)) return
    if (activeIosDownloads.current.size >= MAX_CONCURRENT_IOS_DOWNLOADS) {
      setError('Too many downloads are already running.')
      return
    }

    activeIosDownloads.current.add(normalizedUrl)
    const stagingDirectory = getIosDownloadStagingDirectory()
    try {
      const cookieHeader = await CookieManager.getCookieHeader(normalizedUrl, true)
      stagingDirectory.create({ intermediates: true, idempotent: true })
      const stagedFile = await File.downloadFileAsync(normalizedUrl, stagingDirectory, {
        headers: cookieHeader ? { Cookie: cookieHeader } : undefined
      })
      moveIosDownloadIntoPlace(stagedFile)
      await refresh()
    } catch (downloadError) {
      console.error('Failed downloading file:', downloadError)
      setError('Unable to download this file.')
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
      }
      await refresh()
      return true
    } catch (removeError) {
      console.error('Failed removing browser download:', removeError)
      setError('Unable to remove this download.')
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

  return {
    downloads,
    error,
    isReady,
    openDownload,
    refresh,
    removeDownload,
    requestDownload
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

function moveIosDownloadIntoPlace (stagedFile: File) {
  const directory = getIosDownloadsDirectory()
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
  const existingNames = directory.list()
    .filter((entry): entry is File => entry instanceof File)
    .map((entry) => entry.name)
  const destinationName = createUniqueDownloadFilename(stagedFile.name, existingNames)
  stagedFile.move(new File(directory, destinationName))
}

function listIosDownloads (): BrowserDownload[] {
  const directory = getIosDownloadsDirectory()
  if (!directory.exists) return []

  return directory.list().flatMap((entry) => {
    if (!(entry instanceof File)) return []

    return [{
      id: entry.uri,
      name: entry.name,
      status: 'complete' as const,
      size: entry.size,
      createdAt: entry.creationTime || entry.modificationTime || 0
    }]
  })
}

function hasActiveDownload (downloads: BrowserDownload[]) {
  return downloads.some(({ status }) => status === 'pending' || status === 'running')
}
