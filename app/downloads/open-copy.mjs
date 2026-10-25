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
