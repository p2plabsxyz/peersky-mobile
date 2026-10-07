import { File, Paths } from 'expo-file-system'
import { isLinkedPrivateKey, LINKED_PRIVATE_KEY_FILE } from './private-upload.mjs'

// Whether PeerSky Desktop has sent this phone your identity, and with it the
// key private files and private notes are encrypted with.
export function hasLinkedIdentity () {
  try {
    const file = new File(Paths.document, LINKED_PRIVATE_KEY_FILE)
    return file.exists && isLinkedPrivateKey(file.textSync())
  } catch {
    return false
  }
}
