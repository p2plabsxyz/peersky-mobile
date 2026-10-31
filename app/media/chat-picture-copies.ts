import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

import { chatPicturePlan } from './chat-picture.mjs'
import type { UploadAsset, UploadSource } from './upload-gate'

/**
 * The photos in a pick as clean copies for a chat (see chat-picture.mjs), and
 * the copies to delete once they are sent. A photo the platform cannot decode
 * goes as it is, as it always did.
 */
export async function prepareChatPictures (assets: UploadAsset[], source: UploadSource) {
  const prepared: UploadAsset[] = []
  const copies: string[] = []
  for (const asset of assets) {
    const plan = chatPicturePlan(asset, source)
    if (!plan || !asset.uri) {
      prepared.push(asset)
      continue
    }
    try {
      const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync()
      const saved = await rendered.saveAsync({
        compress: 0.92,
        format: plan.format === 'png' ? SaveFormat.PNG : SaveFormat.JPEG
      })
      copies.push(saved.uri)
      prepared.push({ ...asset, uri: saved.uri, name: plan.name, mimeType: plan.mimeType, size: new File(saved.uri).size })
    } catch {
      prepared.push(asset)
    }
  }
  return { assets: prepared, copies }
}

/** Takes the clean copies off the phone once they are sent, or not. */
export function deleteChatPictureCopies (copies: string[]) {
  for (const uri of copies) {
    try { new File(uri).delete() } catch {}
  }
}
