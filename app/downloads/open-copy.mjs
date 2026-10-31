// Where a file goes, under its own name, to be handed to another app on iOS
// (namedOpenCopy in useBrowserDownloads.ts).
export const OPEN_COPIES_FOLDER = 'peersky-open'

// A name that is safe as one file in that folder, or '' to keep the file's own.
export function openCopyName (name) {
  const fileName = [...String(name || '')]
    .map((char) => (char === '/' || char === '\\' || char.charCodeAt(0) < 32 ? '_' : char))
    .join('')
    .trim()
  if (!fileName || fileName === '.' || fileName === '..') return ''
  return fileName.slice(0, 200)
}

// iOS gives the app a new folder on an update, so a path kept from before one
// (an upload's copy in Recent) points into a folder that is gone, and opening
// it did nothing. Where it sat under Library/Caches or Documents is the same in
// the new folder. Null for a path that is not under either.
export function localPathInAppFolder (uri) {
  const value = String(uri || '')
  for (const [marker, root] of [['/Library/Caches/', 'cache'], ['/Documents/', 'document']]) {
    const at = value.indexOf(marker)
    if (at < 0) continue
    let rest = value.slice(at + marker.length)
    try {
      rest = decodeURIComponent(rest)
    } catch {}
    if (!rest || rest.split('/').some((part) => part === '..' || part === '')) return null
    return { root, rest }
  }
  return null
}
