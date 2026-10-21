import { File, Paths } from 'expo-file-system'
import { getLocalSealKey } from '../privacy/local-seal-key'
import { isLinkedPrivateKeyFile, LINKED_PRIVATE_KEY_FILE } from './private-upload.mjs'

// Whether PeerSky Desktop has sent this phone your identity, and with it the
// key private files and private notes are encrypted with. The file is locked
// with the phone's own key, so it is opened with that: read as plain JSON, a
// linked phone was told to link first and could not upload privately.
export function hasLinkedIdentity () {
  try {
    const file = new File(Paths.document, LINKED_PRIVATE_KEY_FILE)
    return file.exists && isLinkedPrivateKeyFile(file.textSync(), getLocalSealKey())
  } catch {
    return false
  }
}
