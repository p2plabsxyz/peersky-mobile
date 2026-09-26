import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, Paths } from 'expo-file-system'
import { AppState } from 'react-native'

import {
  describeTooManyFiles,
  isTooManyFiles,
  MAX_UPLOAD_BATCH,
  MEDIA_UNSCANNED,
  screenUploadBatch
} from './media-moderation.mjs'

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

let scanner: UploadScanner | null = null

// Leaving the app while the picker is open means its result never arrives, and
// the promise stays pending for the rest of the session. Whatever awaited it
// stays busy, which hides the attach button behind its own spinner. Coming back
// to the app is the signal to give up on it.
const ABANDONED_PICK_GRACE_MS = 2000
let abandonPick: (() => void) | null = null

AppState.addEventListener('change', (state) => {
  if (state !== 'active' || !abandonPick) return
  // Returning from a pick that did work also lands here, a moment before the
  // result arrives, so the grace period is what tells the two apart.
  const giveUp = abandonPick
  setTimeout(() => {
    if (abandonPick === giveUp) giveUp()
  }, ABANDONED_PICK_GRACE_MS)
})

// Android rejects a second pick outright, so this keeps the two in step rather
// than letting the native error reach the user.
async function pickDocuments (options: DocumentPicker.DocumentPickerOptions) {
  if (abandonPick) return null

  try {
    return await new Promise<DocumentPicker.DocumentPickerResult | null>((resolve, reject) => {
      abandonPick = () => resolve(null)
      DocumentPicker.getDocumentAsync(options).then(resolve, reject)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Our state and the platform's disagree. Treat it as no selection rather
    // than showing the user a native error they can do nothing about.
    if (/document picking in progress/i.test(message)) return null
    throw error
  } finally {
    abandonPick = null
  }
}

// The classifier plugs in here. Until one does every file reads as unscanned,
// which is honest: nothing has looked at it, so nothing can vouch for it.
export function setUploadScanner (next: UploadScanner | null) {
  scanner = typeof next === 'function' ? next : null
}

export function hasUploadScanner () {
  return scanner !== null
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
 * and refuses the batch if anything in it is explicit. Screening the whole
 * batch before uploading any of it means a refusal never leaves half a send
 * behind.
 *
 * Returns an empty array when the picker was cancelled. Throws with a sentence
 * worth showing when a file is refused.
 */
/**
 * @param screen Whether to run the classifier over the batch. A direct message
 *   goes to one person who can block the sender, so screening it protects
 *   nobody: the safeguard exists for rooms, where a picture lands in front of
 *   everyone at once before anyone can act.
 */
export async function pickUploads ({
  multiple = false,
  screen = true,
  type
}: { multiple?: boolean, screen?: boolean, type?: string | string[] } = {}): Promise<UploadAsset[]> {
  const selection = await pickDocuments({
    copyToCacheDirectory: true,
    multiple,
    ...(type ? { type } : {})
  })
  if (!selection || selection.canceled || !selection.assets?.length) return []

  if (isTooManyFiles(selection.assets.length)) {
    throw new Error(describeTooManyFiles(selection.assets.length, MAX_UPLOAD_BATCH))
  }

  const assets: UploadAsset[] = selection.assets.map((asset) => {
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

  if (!screen) return assets

  const screened = await Promise.all(assets.map(async (asset) => ({
    fileName: asset.name,
    verdict: await scanAsset(asset)
  })))
  const decision = screenUploadBatch(screened)
  if (!decision.allowed) throw new Error(decision.reason)

  return assets
}
