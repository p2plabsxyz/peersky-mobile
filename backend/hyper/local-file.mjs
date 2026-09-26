// The backend only opens files the app itself put somewhere it can reach. A
// picked file is a copy in our own cache; the original lives outside the
// sandbox and, on Android, behind a content uri the backend cannot open at all.
//
// One list, because there are two callers and they were drifting: adding the
// photo library to the attach sheet meant a photo landed in ImagePicker's
// cache and both callers refused it as "invalid".
const PICKER_CACHE_DIRECTORIES = [
  // A single pick from the Files browser.
  'documentpicker',
  // A photo or video from the camera roll, or one just taken.
  'imagepicker',
  // Where a picked folder's contents are staged before upload.
  'peersky-upload'
]

const PICKER_CACHE_PATH = new RegExp(
  `/(?:cache|caches)/(?:${PICKER_CACHE_DIRECTORIES.join('|')})/`,
  'i'
)

export const MAX_LOCAL_FILE_URI_LENGTH = 8192

/**
 * Turns a file:// uri from a picker into a path the backend may read.
 *
 * @returns {{ path: string, byteLength: number }|null} null when the uri is
 *   malformed, escapes its directory, or points outside a picker cache.
 */
export function normalizePickedLocalFile (fileUri, byteLength) {
  if (
    typeof fileUri !== 'string' ||
    fileUri.length < 1 ||
    fileUri.length > MAX_LOCAL_FILE_URI_LENGTH ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1
  ) return null

  try {
    const parsed = new URL(fileUri)
    if (parsed.protocol !== 'file:' || parsed.hostname || parsed.search || parsed.hash) return null

    const decodedPath = decodeURIComponent(parsed.pathname)
    // A Windows drive letter arrives as "/C:/...", which is not a path.
    const path = /^\/[a-z]:\//i.test(decodedPath) ? decodedPath.slice(1) : decodedPath
    const normalizedPath = path.replaceAll('\\', '/')

    if (
      normalizedPath.includes('\0') ||
      normalizedPath.split('/').some((segment) => segment === '..') ||
      !PICKER_CACHE_PATH.test(normalizedPath)
    ) return null

    return { path, byteLength }
  } catch {
    return null
  }
}
