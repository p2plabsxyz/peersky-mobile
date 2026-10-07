// What the app leaves for its home screen widgets (targets/widgets). They
// cannot open the app's own files, so it is written to an App Group both can
// read, as small JSON strings the Swift side decodes.
export const WIDGET_APP_GROUP = 'group.xyz.p2plabs.peersky'

// The widget kinds, for reloading one after its data changes.
export const BROWSER_WIDGET_KIND = 'PeerSkyBrowser'
export const PEERTUNES_WIDGET_KIND = 'PeerTunesNowPlaying'

export const WIDGET_KEYS = Object.freeze({
  bookmarks: 'browserBookmarks',
  nowPlaying: 'peertunesNowPlaying',
  artwork: 'peertunesArtwork'
})

// The large widget has room for three under the apps.
export const MAX_WIDGET_BOOKMARKS = 3
const MAX_WIDGET_TEXT = 120
const MAX_WIDGET_URL_LENGTH = 2048
// A 256 pixel JPEG is a few tens of kilobytes. Anything far past that is not
// the thumbnail the player page makes, and the widget would choke on it.
const MAX_ARTWORK_BASE64_LENGTH = 200 * 1024
const OPENABLE_URL = /^(https?|hyper):\/\//i

/** The newest bookmarks, as the large widget lists them. */
export function toWidgetBookmarks (bookmarks, limit = MAX_WIDGET_BOOKMARKS) {
  return (Array.isArray(bookmarks) ? bookmarks : [])
    .filter((bookmark) => (
      typeof bookmark?.url === 'string' &&
      bookmark.url.length <= MAX_WIDGET_URL_LENGTH &&
      OPENABLE_URL.test(bookmark.url)
    ))
    .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0))
    .slice(0, limit)
    .map((bookmark) => ({
      title: cleanWidgetText(bookmark.title) || hostOf(bookmark.url),
      url: bookmark.url
    }))
}

/**
 * The PeerTunes widget's state. Live while the player page is open and can
 * take the widget's buttons; otherwise the widget shows the last song and
 * opens PeerTunes when tapped.
 */
export function toPeerTunesWidgetState (nowPlaying, { live = true } = {}) {
  return {
    live: live === true,
    playing: live === true && nowPlaying?.playing === true,
    title: cleanWidgetText(nowPlaying?.title),
    artist: cleanWidgetText(nowPlaying?.artist),
    album: cleanWidgetText(nowPlaying?.album)
  }
}

/** The base64 inside the page's JPEG or PNG thumbnail, or null. */
export function readArtworkBase64 (dataUrl) {
  const match = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl || ''))
  if (!match || match[1].length > MAX_ARTWORK_BASE64_LENGTH) return null
  return match[1]
}

function cleanWidgetText (value) {
  return Array.from(typeof value === 'string' ? value.trim() : '')
    .filter((character) => character.codePointAt(0) >= 32)
    .slice(0, MAX_WIDGET_TEXT)
    .join('')
    .trim()
}

function hostOf (url) {
  const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)
  return match ? match[1].replace(/^www\./i, '') : url
}
