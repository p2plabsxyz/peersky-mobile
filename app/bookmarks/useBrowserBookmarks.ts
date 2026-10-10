import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import {
  addBrowserBookmark,
  createBrowserBookmarkFolder,
  deleteBrowserBookmarkFolder,
  findBrowserBookmark,
  isBrowserUrlBookmarked,
  MAX_BROWSER_BOOKMARKS,
  mergeIncomingBrowserBookmarks,
  moveBrowserBookmark,
  parseBrowserBookmarkStore,
  removeBrowserBookmark,
  renameBrowserBookmarkFolder,
  restoreBrowserBookmark,
  serializeBrowserBookmarks
} from './browser-bookmarks.mjs'

export type BrowserBookmark = {
  url: string
  title: string
  createdAt: number
  favicon?: string
  // The folder it is in, or none for the top of Bookmarks.
  folder?: string
}

export type BrowserBookmarkFolder = {
  id: string
  title: string
  createdAt: number
}

// A bookmark and its place in the list, kept to undo removing it.
export type BrowserBookmarkPlace = {
  bookmark: BrowserBookmark
  index: number
}

export function useBrowserBookmarks () {
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([])
  const bookmarksRef = useRef(bookmarks)
  const [folders, setFolders] = useState<BrowserBookmarkFolder[]>([])
  const foldersRef = useRef(folders)
  const [isReady, setIsReady] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadBookmarks () {
      try {
        const file = getBookmarksFile()
        const store = file.exists
          ? parseBrowserBookmarkStore(await file.text()) as { bookmarks: BrowserBookmark[], folders: BrowserBookmarkFolder[] }
          : { bookmarks: [], folders: [] }
        const stored = store.bookmarks
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
            file.write(serializeBrowserBookmarks(restored, store.folders))
          }
          removeIncomingBookmarks()
        }
        if (!cancelled) {
          bookmarksRef.current = restored
          foldersRef.current = store.folders
          setBookmarks(restored)
          setFolders(store.folders)
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

  function persistBookmarks (nextBookmarks: BrowserBookmark[], nextFolders: BrowserBookmarkFolder[] = foldersRef.current) {
    if (!isReady) {
      setPersistenceError('Bookmarks are still loading. Try again in a moment.')
      return false
    }

    try {
      const file = getBookmarksFile()
      if (!file.exists) file.create({ intermediates: true })
      file.write(serializeBrowserBookmarks(nextBookmarks, nextFolders))
      bookmarksRef.current = nextBookmarks
      foldersRef.current = nextFolders
      setBookmarks(nextBookmarks)
      setFolders(nextFolders)
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
    folders,
    isReady,
    persistenceError,
    // The new folder's id, or null when it could not be made.
    createFolder: (title: string) => {
      const { folders: nextFolders, folder } = createBrowserBookmarkFolder(foldersRef.current, title) as {
        folders: BrowserBookmarkFolder[]
        folder: BrowserBookmarkFolder | null
      }
      if (!folder || !persistBookmarks(bookmarksRef.current, nextFolders)) return null
      return folder.id
    },
    renameFolder: (folderId: string, title: string) => {
      return persistBookmarks(
        bookmarksRef.current,
        renameBrowserBookmarkFolder(foldersRef.current, folderId, title) as BrowserBookmarkFolder[]
      )
    },
    deleteFolder: (folderId: string) => {
      const next = deleteBrowserBookmarkFolder({ bookmarks: bookmarksRef.current, folders: foldersRef.current }, folderId) as {
        bookmarks: BrowserBookmark[]
        folders: BrowserBookmarkFolder[]
      }
      return persistBookmarks(next.bookmarks, next.folders)
    },
    moveBookmark: (url: string, folderId: string | null) => {
      return persistBookmarks(moveBrowserBookmark(bookmarksRef.current, url, folderId) as BrowserBookmark[])
    },
    isBookmarked: (url: string) => isBrowserUrlBookmarked(bookmarksRef.current, url),
    findBookmark: (url: string) => findBrowserBookmark(bookmarksRef.current, url) as BrowserBookmarkPlace | null,
    restoreBookmark: (place: BrowserBookmarkPlace) => {
      const nextBookmarks = restoreBrowserBookmark(bookmarksRef.current, place, foldersRef.current) as BrowserBookmark[]
      return nextBookmarks !== bookmarksRef.current && persistBookmarks(nextBookmarks)
    },
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
