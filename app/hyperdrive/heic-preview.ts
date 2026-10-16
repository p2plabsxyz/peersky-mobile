import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Image } from 'react-native'

import { isHeicName, PREVIEW_MAX_SIDE, PREVIEW_QUALITY } from '../../backend/hyper/heic-preview.mjs'

export type HeicPreview = { uri: string, size: number }

// Inside the staging folder the backend reads picked files from.
const PREVIEW_FOLDER = ['peersky-upload', 'previews']

/**
 * A JPEG copy of a HEIC photo for the Hyperdrive viewer, whose engine cannot
 * draw HEIC on desktop and Android. Null for any other file, and when the copy
 * cannot be made: the photo uploads either way.
 */
export async function makeHeicPreview (asset: { name: string, uri: string }): Promise<HeicPreview | null> {
  if (!isHeicName(asset.name)) return null

  let manipulation = null
  let image = null
  let rendered: File | null = null
  try {
    manipulation = ImageManipulator.manipulate(asset.uri)
    try {
      const { width, height } = await Image.getSize(asset.uri)
      if (Math.max(width, height) > PREVIEW_MAX_SIDE) {
        manipulation.resize(width >= height ? { width: PREVIEW_MAX_SIDE } : { height: PREVIEW_MAX_SIDE })
      }
    } catch {
      // No size, no resize: the copy is just bigger.
    }
    image = await manipulation.renderAsync()
    const result = await image.saveAsync({ compress: PREVIEW_QUALITY, format: SaveFormat.JPEG })
    rendered = new File(result.uri)

    const folder = new Directory(Paths.cache, ...PREVIEW_FOLDER)
    if (!folder.exists) folder.create({ intermediates: true })
    const copy = new File(folder, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.jpg`)
    rendered.copy(copy)
    const size = copy.size ?? 0
    if (size < 1) {
      discardHeicPreview({ uri: copy.uri, size })
      return null
    }
    return { uri: copy.uri, size }
  } catch {
    return null
  } finally {
    image?.release()
    manipulation?.release()
    try { rendered?.delete() } catch {}
  }
}

export function discardHeicPreview (preview: HeicPreview | null) {
  if (!preview) return
  try { new File(preview.uri).delete() } catch {}
}
