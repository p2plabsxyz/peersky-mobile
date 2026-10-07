import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { Directory, File, Paths } from 'expo-file-system'
import { AppState } from 'react-native'

import {
  describeTooManyFiles,
  isTooManyFiles,
  MAX_UPLOAD_BATCH,
  MEDIA_UNSCANNED,
  screenUploadBatch
} from './media-moderation.mjs'
import { ensurePermission } from '../permission-prompt'

export type UploadAsset = {
  name: string
  size: number
  mimeType: string
  // A picked file always has a uri. P2PMD's editor hands its bytes over from
  // inside a WebView instead, so that path carries base64 and no uri.
  uri: string
  base64?: string
}

export type UploadScanner = (asset: UploadAsset) => Promise<string>

/**
 * Where a batch came from. The Files browser cannot reach the camera roll on
 * iOS, so "attach" used to mean "open Files" and a photo took several taps
 * through the Photos app to reach. P2PMD gets all three for free because its
 * picker is a web file input and iOS draws that sheet itself.
 */
export type UploadSource = 'files' | 'library' | 'camera'

let scanner: UploadScanner | null = null

// Leaving the app while the picker is open means its result never arrives, and
// the promise stays pending for the rest of the session. Whatever awaited it
// stays busy, which hides the attach button behind its own spinner. Coming back
// to the app is the signal to give up on it.
const ABANDONED_PICK_GRACE_MS = 2000
// And a picker that never appeared at all never answers either, and the app
// never left the foreground for the listener below to notice. Long enough that
// nobody browsing their photo library trips it, short enough that a session
// recovers instead of leaving the attach button disabled for good.
const PICK_TIMEOUT_MS = 2 * 60 * 1000
let abandonPick: (() => void) | null = null

/**
 * Gives up on whatever pick is still waiting, so a new one can run.
 *
 * This used to refuse instead, which is right while a picker is genuinely on
 * screen and wrong once one has wedged: every later attach became a silent
 * no-op for the rest of the session. Nothing can start a second pick while the
 * first is really open, because the button that starts it is disabled.
 */
function supersedePendingPick () {
  const stale = abandonPick
  abandonPick = null
  stale?.()
}

AppState.addEventListener('change', (state) => {
  if (state !== 'active' || !abandonPick) return
  // Returning from a pick that did work also lands here, a moment before the
  // result arrives, so the grace period is what tells the two apart.
  const giveUp = abandonPick
  setTimeout(() => {
    if (abandonPick === giveUp) giveUp()
  }, ABANDONED_PICK_GRACE_MS)
})

async function pickImages (
  source: 'library' | 'camera',
  multiple: boolean
): Promise<ImagePicker.ImagePickerResult | null> {
  supersedePendingPick()

  // The library needs no permission: the system photo picker runs outside the
  // app and hands back only what was chosen. Asking for the whole library
  // anyway is a prompt nobody needs and a question a store review asks.
  if (source === 'camera') {
    const allowed = await ensurePermission({
      request: () => ImagePicker.requestCameraPermissionsAsync(),
      title: 'Camera access is off',
      message: 'PeerSky needs the camera to take a photo. Turn it on in Settings.'
    })
    if (!allowed) throw new Error('PeerSky needs camera access to take a photo.')
  }

  const options: ImagePicker.ImagePickerOptions = {
    allowsMultipleSelection: source === 'library' && multiple,
    mediaTypes: ['images', 'videos'],
    quality: 1
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await new Promise<ImagePicker.ImagePickerResult | null>((resolve, reject) => {
      abandonPick = () => resolve(null)
      timer = setTimeout(() => abandonPick?.(), PICK_TIMEOUT_MS)
      const launch = source === 'camera'
        ? ImagePicker.launchCameraAsync(options)
        : ImagePicker.launchImageLibraryAsync(options)
      launch.then(resolve, reject)
    })
  } finally {
    if (timer) clearTimeout(timer)
    abandonPick = null
  }
}

// Android rejects a second pick outright, so this keeps the two in step rather
// than letting the native error reach the user.
async function pickDocuments (options: DocumentPicker.DocumentPickerOptions) {
  supersedePendingPick()

  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await new Promise<DocumentPicker.DocumentPickerResult | null>((resolve, reject) => {
      abandonPick = () => resolve(null)
      timer = setTimeout(() => abandonPick?.(), PICK_TIMEOUT_MS)
      DocumentPicker.getDocumentAsync(options).then(resolve, reject)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Our state and the platform's disagree. Treat it as no selection rather
    // than showing the user a native error they can do nothing about.
    if (/document picking in progress/i.test(message)) return null
    throw error
  } finally {
    if (timer) clearTimeout(timer)
    abandonPick = null
  }
}

// The classifier plugs in here. Until one does every file reads as unscanned,
// which is honest: nothing has looked at it, so nothing can vouch for it.
export function setUploadScanner (next: UploadScanner | null) {
  scanner = typeof next === 'function' ? next : null
}

/**
 * For bytes that never came from the picker. P2PMD's editor hands its images
 * over from inside a WebView as base64, so there is no file to point at, but
 * the same gate has to apply or that becomes the way around it.
 */
export async function screenUploadBytes (asset: Omit<UploadAsset, 'uri'> & { uri?: string }) {
  const decision = screenUploadBatch([{
    fileName: asset.name,
    verdict: await scanAsset({ uri: '', ...asset })
  }])
  if (!decision.allowed) throw new Error(decision.reason)
}

async function scanAsset (asset: UploadAsset) {
  if (!scanner) return MEDIA_UNSCANNED
  try {
    return await scanner(asset)
  } catch {
    // A classifier that fell over tells us nothing, so the file is unscanned
    // rather than cleared.
    return MEDIA_UNSCANNED
  }
}

// A folder holds more than a hand-picked batch would, but not without limit:
// every picture in it is screened, and each one costs a moment.
const MAX_FOLDER_FILES = 50
// Deep enough for an ordinary photo folder, shallow enough that a pathological
// tree cannot walk forever.
const MAX_FOLDER_DEPTH = 5
// The backend only opens files it copied itself, so a picked folder's contents
// are staged here first. On Android the originals sit behind a content uri it
// cannot open at all.
const STAGING_FOLDER = 'peersky-upload'

function collectFiles (folder: Directory, depth: number, into: File[]) {
  if (depth > MAX_FOLDER_DEPTH || into.length >= MAX_FOLDER_FILES) return
  for (const entry of folder.list()) {
    if (into.length >= MAX_FOLDER_FILES) return
    if (entry instanceof Directory) collectFiles(entry, depth + 1, into)
    // A zero byte entry is nothing worth uploading and breaks the size guard.
    else if ((entry.size ?? 0) > 0) into.push(entry)
  }
}

/**
 * Picks a folder and screens everything in it, the same gate a hand-picked
 * batch goes through. The files are copied into a staging folder first: the
 * originals live outside the sandbox, and on Android behind a content uri the
 * backend cannot open.
 */
export async function pickUploadFolder (): Promise<UploadAsset[]> {
  if (abandonPick) return []

  let folder: Directory
  try {
    folder = await Directory.pickDirectoryAsync()
  } catch {
    // Cancelling is the ordinary case and is not worth an error.
    return []
  }

  const found: File[] = []
  collectFiles(folder, 0, found)
  if (found.length === 0) throw new Error('That folder has no files in it.')

  const staging = new Directory(Paths.cache, STAGING_FOLDER)
  if (staging.exists) staging.delete()
  staging.create()

  const assets: UploadAsset[] = []
  for (const [index, source] of found.entries()) {
    // Prefixed, so two files with the same name in different subfolders do not
    // overwrite each other on the way through.
    const name = source.name || `file-${index}`
    const target = new File(staging, `${index}-${name}`)
    try {
      source.copy(target)
    } catch {
      // On Android a picked folder hands back content:// uris, and copy refuses
      // those outright: "This method cannot be used with content URIs". Reading
      // the bytes and writing them goes through the same provider that opened
      // the folder, so it works where copy does not.
      if (!target.exists) target.create()
      target.write(await source.bytes())
    }
    assets.push({
      uri: target.uri,
      name,
      size: target.size ?? source.size ?? 0,
      mimeType: ''
    })
  }

  const screened = await Promise.all(assets.map(async (asset) => ({
    fileName: asset.name,
    verdict: await scanAsset(asset)
  })))
  const decision = screenUploadBatch(screened)
  if (!decision.allowed) {
    staging.delete()
    throw new Error(decision.reason)
  }

  return assets
}

/**
 * The one place every upload in the app passes through: PeerChat attachments,
 * Hyperdrive library files and P2PMD images. Picks the files, bounds how many,
 * and screens the whole batch before uploading any, so a refusal never leaves
 * half a send behind. Returns [] when the picker is cancelled, and throws a
 * sentence worth showing when a file is refused.
 *
 * @param screen Whether to run the classifier. It is for rooms, where a picture
 *   lands in front of everyone at once. A direct message goes to one person
 *   who can block the sender, so screening it protects nobody.
 */
export async function pickUploads ({
  multiple = false,
  screen = true,
  source = 'files',
  type
}: {
  multiple?: boolean
  screen?: boolean
  source?: UploadSource
  type?: string | string[]
} = {}): Promise<UploadAsset[]> {
  const picked = source === 'files'
    ? await pickFromFiles(multiple, type)
    : await pickFromPhotos(source, multiple)
  if (picked.length === 0) return []

  if (isTooManyFiles(picked.length)) {
    throw new Error(describeTooManyFiles(picked.length, MAX_UPLOAD_BATCH))
  }

  return screen ? await screenAssets(picked) : picked
}

async function pickFromFiles (multiple: boolean, type?: string | string[]): Promise<UploadAsset[]> {
  const selection = await pickDocuments({
    copyToCacheDirectory: true,
    multiple,
    ...(type ? { type } : {})
  })
  if (!selection || selection.canceled || !selection.assets?.length) return []

  return selection.assets.map((asset) => {
    const file = new File(asset.uri)
    const size = asset.size ?? file.size
    if (!Number.isSafeInteger(size) || !size) throw new Error('Choose a non-empty file.')
    return {
      uri: file.uri,
      name: asset.name,
      size,
      mimeType: asset.mimeType || ''
    }
  })
}

async function pickFromPhotos (
  source: 'library' | 'camera',
  multiple: boolean
): Promise<UploadAsset[]> {
  const selection = await pickImages(source, multiple)
  if (!selection || selection.canceled || !selection.assets?.length) return []

  return selection.assets.map((asset) => {
    const file = new File(asset.uri)
    const size = asset.fileSize ?? file.size
    if (!Number.isSafeInteger(size) || !size) throw new Error('Choose a non-empty file.')
    return {
      uri: file.uri,
      // The camera roll does not always hand over a name, and a photo with no
      // name arrives in the room as "undefined".
      name: asset.fileName || nameFromUri(file.uri, asset.mimeType),
      size,
      mimeType: asset.mimeType || ''
    }
  })
}

function nameFromUri (uri: string, mimeType?: string) {
  const fromPath = uri.split(/[?#]/, 1)[0].split('/').pop() || ''
  if (fromPath.includes('.')) return fromPath
  const extension = String(mimeType || '').split('/')[1] || 'jpg'
  return `${fromPath || 'photo'}.${extension.split('+')[0]}`
}

async function screenAssets (assets: UploadAsset[]): Promise<UploadAsset[]> {
  const screened = await Promise.all(assets.map(async (asset) => ({
    fileName: asset.name,
    verdict: await scanAsset(asset)
  })))
  const decision = screenUploadBatch(screened)
  if (!decision.allowed) throw new Error(decision.reason)

  return assets
}
