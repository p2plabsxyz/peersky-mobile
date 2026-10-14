import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'

import { peerChatMediaType, savedFolderName } from './media-save.mjs'

/**
 * Saving a picture or video from a chat to the phone, the ways the app
 * already saves files elsewhere and with no permission it does not have.
 *
 * iOS: the share sheet, as the downloads do, where Save Image or Save Video
 * puts it in Photos. Adding to Photos is what NSPhotoLibraryAddUsageDescription
 * is there for.
 *
 * Android: a folder the person picks once with the system's own picker,
 * Pictures to start with, which the gallery shows. The choice is kept, so the
 * next save goes straight there. The app is given that one folder and nothing
 * else on the phone.
 */
const SAVE_FOLDER_FILE = new File(Paths.document, 'peerchat-save-folder.txt')
const PICTURES_FOLDER = 'content://com.android.externalstorage.documents/document/primary%3APictures'
// Copied a piece at a time, so a long video is never in memory whole.
const COPY_CHUNK_BYTES = 1024 * 1024

export type SavedPeerChatMedia = {
  // Where it went, to say so, or empty when the share sheet said it already.
  message: string
}

export async function savePeerChatMedia ({ uri, fileName }: { uri: string, fileName: string }): Promise<SavedPeerChatMedia | null> {
  const mimeType = peerChatMediaType(fileName)
  if (!mimeType) throw new Error('Only pictures and videos can be saved.')

  if (Platform.OS !== 'android') {
    if (!await Sharing.isAvailableAsync()) throw new Error('Saving is not available on this phone.')
    await Sharing.shareAsync(namedCopy(uri, fileName), {
      dialogTitle: fileName,
      mimeType,
      UTI: mimeType.startsWith('video/') ? 'public.movie' : 'public.image'
    })
    return { message: '' }
  }

  let folder = rememberedFolder()
  // Once more with a folder picked again, when the one kept is gone or no
  // longer allowed.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!folder) {
      folder = await pickFolder()
      if (!folder) return null
      rememberFolder(folder.uri)
    }
    try {
      copyInto(folder, uri, fileName, mimeType)
      return { message: `Saved to ${savedFolderName(folder.uri)}` }
    } catch (error) {
      forgetFolder()
      folder = null
      if (attempt > 0) throw error
    }
  }
  return null
}

// Copies of chat files kept outside the stores: the ones Save and Share
// handed on, and the JPEGs the picture check and a profile picture's resize
// write. The chats they came from go with Clear all P2P data, Remove my data
// and a restore, and so do these.
export function clearChatFileCopies () {
  for (const name of ['peerchat-save', 'ImageManipulator']) {
    try {
      const folder = new Directory(Paths.cache, name)
      if (folder.exists) folder.delete()
    } catch {}
  }
}

// The opened copy is kept under a name with a fingerprint in front, which
// the share sheet showed and Save to Files kept. A copy under the name it was
// sent with goes instead.
function namedCopy (uri: string, fileName: string) {
  try {
    const folder = new Directory(Paths.cache, 'peerchat-save')
    if (!folder.exists) folder.create({ intermediates: true })
    const target = new File(folder, fileName.replace(/[/\\]/g, '_'))
    if (target.exists) target.delete()
    new File(uri).copy(target)
    return target.uri
  } catch {
    return uri
  }
}

async function pickFolder () {
  try {
    return await Directory.pickDirectoryAsync(PICTURES_FOLDER)
  } catch {
    // Cancelling is the ordinary case and not worth an error.
    return null
  }
}

function copyInto (folder: Directory, uri: string, fileName: string, mimeType: string) {
  const source = new File(uri)
  const target = folder.createFile(fileName, mimeType)
  const handle = source.open()
  try {
    let first = true
    for (;;) {
      const chunk = handle.readBytes(COPY_CHUNK_BYTES)
      if (chunk.byteLength === 0) break
      target.write(chunk, { append: !first })
      first = false
    }
    if (first) throw new Error('That picture or video is empty.')
  } catch (error) {
    try { target.delete() } catch {}
    throw error
  } finally {
    handle.close()
  }
}

function rememberedFolder () {
  try {
    if (!SAVE_FOLDER_FILE.exists) return null
    const uri = SAVE_FOLDER_FILE.textSync().trim()
    if (!uri.startsWith('content://')) return null
    const folder = new Directory(uri)
    return folder.exists ? folder : null
  } catch {
    return null
  }
}

function rememberFolder (uri: string) {
  try {
    if (!SAVE_FOLDER_FILE.exists) SAVE_FOLDER_FILE.create({ intermediates: true })
    SAVE_FOLDER_FILE.write(uri)
  } catch {}
}

function forgetFolder () {
  try {
    if (SAVE_FOLDER_FILE.exists) SAVE_FOLDER_FILE.delete()
  } catch {}
}
