import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import {
  addBrowserBookmark,
  isBrowserUrlBookmarked,
  MAX_BROWSER_BOOKMARKS,
  mergeIncomingBrowserBookmarks,
  parseBrowserBookmarks,
  removeBrowserBookmark,
  serializeBrowserBookmarks
} from './browser-bookmarks.mjs'

export type BrowserBookmark = {
  url: string
  title: string
  createdAt: number
  favicon?: string
}

export function useBrowserBookmarks () {
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([])
  const bookmarksRef = useRef(bookmarks)
  const [isReady, setIsReady] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadBookmarks () {
      try {
        const file = getBookmarksFile()
        const stored = file.exists
          ? parseBrowserBookmarks(await file.text()) as BrowserBookmark[]
          : []
        // Bookmarks from another device, left by a Link Device restore. They
        // go after the ones already here, and the file that brought them is
        // only removed once they are saved.
        const incoming = await readIncomingBookmarks()
        const restored = incoming
          ? mergeIncomingBrowserBookmarks(stored, incoming) as BrowserBookmark[]
          : stored
        if (incoming) {
          if (restored !== stored) {
            if (!file.exists) file.create({ intermediates: true })
            file.write(serializeBrowserBookmarks(restored))
          }
          removeIncomingBookmarks()
        }
        if (!cancelled) {
          bookmarksRef.current = restored
          setBookmarks(restored)
        }
      } catch (error) {
        console.error('Failed loading browser bookmarks:', error)
        if (!cancelled) setPersistenceError('Unable to load bookmarks.')
      } finally {
        if (!cancelled) setIsReady(true)
      }
    }

    void loadBookmarks()
    return () => {
      cancelled = true
    }
  }, [])

  function persistBookmarks (nextBookmarks: BrowserBookmark[]) {
    if (!isReady) {
      setPersistenceError('Bookmarks are still loading. Try again in a moment.')
      return false
    }

    try {
      const file = getBookmarksFile()
      if (!file.exists) file.create({ intermediates: true })
      file.write(serializeBrowserBookmarks(nextBookmarks))
      bookmarksRef.current = nextBookmarks
      setBookmarks(nextBookmarks)
      setPersistenceError(null)
      return true
    } catch (error) {
      console.error('Failed saving browser bookmarks:', error)
      setPersistenceError('Unable to save bookmarks. Your previous bookmarks are unchanged.')
      return false
    }
  }

  return {
    bookmarks,
    isReady,
    persistenceError,
    isBookmarked: (url: string) => isBrowserUrlBookmarked(bookmarksRef.current, url),
    toggleBookmark: ({
      url,
      title,
      favicon
    }: {
      url: string
      title: string
      favicon?: string | null
    }) => {
      const wasBookmarked = isBrowserUrlBookmarked(bookmarksRef.current, url)
      if (!wasBookmarked && bookmarksRef.current.length >= MAX_BROWSER_BOOKMARKS) {
        return 'limit-reached'
      }

      const nextBookmarks = wasBookmarked
        ? removeBrowserBookmark(bookmarksRef.current, url)
        : addBrowserBookmark(bookmarksRef.current, { url, title, favicon })

      if (!persistBookmarks(nextBookmarks)) return null
      return wasBookmarked ? 'removed' : 'added'
    },
    removeBookmark: (url: string) => {
      return persistBookmarks(removeBrowserBookmark(bookmarksRef.current, url))
    }
  }
}

function getBookmarksFile () {
  return new File(Paths.document, 'browser-bookmarks.json')
}

function getIncomingBookmarksFile () {
  return new File(Paths.document, 'incoming-bookmarks.json')
}

async function readIncomingBookmarks () {
  try {
    const file = getIncomingBookmarksFile()
    if (!file.exists) return null
    return JSON.parse(await file.text())
  } catch (error) {
    console.error('Failed reading bookmarks from another device:', error)
    removeIncomingBookmarks()
    return null
  }
}

function removeIncomingBookmarks () {
  try {
    const file = getIncomingBookmarksFile()
    if (file.exists) file.delete()
  } catch {}
}
