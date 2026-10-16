// Chromium (the desktop app, Android's WebView) cannot draw an iPhone's HEIC
// photos, so the Hyperdrive viewer shows a placeholder for them. When the
// phone uploads one it also puts a small JPEG copy in the same drive, and the
// viewer looks for it at the path below. A pure module, so the app, the
// backend and the tests share one answer.
//
// The viewer has its own copy of previewPathFor (viewer/lib/kinds.js); keep
// the two alike.
export const PREVIEW_FOLDER = '/.peersky/previews'
export const PREVIEW_MAX_SIDE = 1600
export const PREVIEW_QUALITY = 0.8

const HEIC_NAME = /\.(?:heic|heif)$/i

export function isHeicName (name) {
  return HEIC_NAME.test(String(name ?? ''))
}

/** Where the JPEG copy of a photo goes: its own path under the previews folder, plus .jpg. */
export function previewPathFor (pathname) {
  return `${PREVIEW_FOLDER}/${String(pathname ?? '').replace(/^\/+/, '')}.jpg`
}
