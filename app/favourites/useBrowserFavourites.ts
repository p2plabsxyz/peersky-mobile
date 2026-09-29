import { useEffect, useRef, useState } from 'react'
import { File, Paths } from 'expo-file-system'
import {
  addBrowserFavourite,
  isBrowserUrlFavourited,
  MAX_BROWSER_FAVOURITES,
  parseBrowserFavourites,
  removeBrowserFavourite,
  serializeBrowserFavourites
} from './browser-favourites.mjs'

export type BrowserFavourite = {
  url: string
  title: string
  createdAt: number
  favicon?: string
}

export function useBrowserFavourites () {
  const [favourites, setFavourites] = useState<BrowserFavourite[]>([])
  const favouritesRef = useRef(favourites)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadFavourites () {
      try {
        const file = getFavouritesFile()
        if (!file.exists) return

        const restored = parseBrowserFavourites(await file.text()) as BrowserFavourite[]
        if (!cancelled) {
          favouritesRef.current = restored
          setFavourites(restored)
        }
      } catch (error) {
        console.error('Failed loading home favourites:', error)
      } finally {
        if (!cancelled) setIsReady(true)
      }
    }

    void loadFavourites()
    return () => {
      cancelled = true
    }
  }, [])

  function persist (next: BrowserFavourite[]) {
    if (!isReady) return false

    try {
      const file = getFavouritesFile()
      if (!file.exists) file.create({ intermediates: true })
      file.write(serializeBrowserFavourites(next))
      favouritesRef.current = next
      setFavourites(next)
      return true
    } catch (error) {
      console.error('Failed saving home favourites:', error)
      return false
    }
  }

  return {
    favourites,
    isReady,
    isFavourited: (url: string) => isBrowserUrlFavourited(favouritesRef.current, url),
    toggleFavourite: ({
      url,
      title,
      favicon
    }: {
      url: string
      title: string
      favicon?: string | null
    }) => {
      const wasFavourited = isBrowserUrlFavourited(favouritesRef.current, url)
      if (!wasFavourited && favouritesRef.current.length >= MAX_BROWSER_FAVOURITES) {
        return 'limit-reached'
      }

      const next = wasFavourited
        ? removeBrowserFavourite(favouritesRef.current, url)
        : addBrowserFavourite(favouritesRef.current, { url, title, favicon })

      if (!persist(next as BrowserFavourite[])) return null
      return wasFavourited ? 'removed' : 'added'
    },
    removeFavourite: (url: string) => {
      return persist(removeBrowserFavourite(favouritesRef.current, url) as BrowserFavourite[])
    }
  }
}

function getFavouritesFile () {
  return new File(Paths.document, 'browser-favourites.json')
}
