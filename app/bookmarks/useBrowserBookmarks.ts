import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import {
  addBrowserBookmark,
  isBrowserUrlBookmarked,
  parseBrowserBookmarks,
  removeBrowserBookmark,
  serializeBrowserBookmarks
} from './browser-bookmarks.mjs'

export type BrowserBookmark = {
  url: string
  title: string
  createdAt: number
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
        if (!file.exists) return

        const restored = parseBrowserBookmarks(await file.text()) as BrowserBookmark[]
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
    toggleBookmark: ({ url, title }: { url: string, title: string }) => {
      const wasBookmarked = isBrowserUrlBookmarked(bookmarksRef.current, url)
      const nextBookmarks = wasBookmarked
        ? removeBrowserBookmark(bookmarksRef.current, url)
        : addBrowserBookmark(bookmarksRef.current, { url, title })

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
