import { requireOptionalNativeModule } from 'expo'

import {
  BROWSER_WIDGET_KIND,
  PEERTUNES_WIDGET_KIND,
  WIDGET_APP_GROUP,
  WIDGET_KEYS,
  readArtworkBase64,
  toPeerTunesWidgetState,
  toWidgetBookmarks
} from './widget-data.mjs'

// modules/peersky-widget-storage. The home screen widgets are iOS only for
// now, and elsewhere the module is not there, so this does nothing.
const widgets = requireOptionalNativeModule<{
  getString: (group: string, key: string) => string | null
  setString: (group: string, key: string, value: string) => void
  reload: (kind: string) => void
}>('PeerSkyWidgetStorage')

// What was last written, so a page reporting the same song again does not
// redraw the widget.
const written = new Map<string, string>()

type NowPlaying = {
  playing: boolean
  title: string
  artist: string
  album?: string
  artwork?: string
}

function write (key: string, value: string) {
  if (!widgets || written.get(key) === value) return false
  try {
    widgets.setString(WIDGET_APP_GROUP, key, value)
    written.set(key, value)
    return true
  } catch (error) {
    console.warn('Unable to update the widgets:', error)
    return false
  }
}

// A song arrives as two or three reports close together: what is playing,
// then its cover once the page has drawn it small. Each used to reload the
// widget, and iOS grants an app in the background few reloads, so a song
// started from the widget could keep the coverless one until the next press.
// One reload, once the reports settle, carries the cover the first time.
const RELOAD_SETTLE_MS = 400
const pendingReloads = new Map<string, ReturnType<typeof setTimeout>>()

function reload (kind: string) {
  if (!widgets) return
  const pending = pendingReloads.get(kind)
  if (pending) clearTimeout(pending)
  pendingReloads.set(kind, setTimeout(() => {
    pendingReloads.delete(kind)
    try {
      widgets.reload(kind)
    } catch {}
  }, RELOAD_SETTLE_MS))
}

/** The bookmarks the large PeerSky widget lists. */
export function updateBrowserWidget (bookmarks: unknown) {
  if (write(WIDGET_KEYS.bookmarks, JSON.stringify(toWidgetBookmarks(bookmarks)))) {
    reload(BROWSER_WIDGET_KIND)
  }
}

/** What the open PeerTunes page says is playing. Its buttons work now. */
export function updatePeerTunesWidget (nowPlaying: NowPlaying) {
  const artworkChanged = nowPlaying.artwork !== undefined &&
    write(WIDGET_KEYS.artwork, readArtworkBase64(nowPlaying.artwork) ?? '')
  const stateChanged = write(WIDGET_KEYS.nowPlaying, JSON.stringify(toPeerTunesWidgetState(nowPlaying)))
  if (artworkChanged || stateChanged) reload(PEERTUNES_WIDGET_KIND)
}

/**
 * A widget button changed what the widget shows before the page acted on it,
 * so what was written last is no longer what the widget has. The page's next
 * report is written whatever it says.
 */
export function forgetPeerTunesWidgetState () {
  written.delete(WIDGET_KEYS.nowPlaying)
}

/**
 * No player page to take the buttons: PeerTunes was closed, or the app has
 * just started. The widget keeps the last song and opens PeerTunes instead.
 */
export function idlePeerTunesWidget () {
  if (!widgets) return
  let last: Partial<NowPlaying> = {}
  try {
    last = JSON.parse(widgets.getString(WIDGET_APP_GROUP, WIDGET_KEYS.nowPlaying) || '{}') || {}
  } catch {}
  const idle = toPeerTunesWidgetState(last, { live: false })
  if (write(WIDGET_KEYS.nowPlaying, JSON.stringify(idle))) reload(PEERTUNES_WIDGET_KIND)
}
