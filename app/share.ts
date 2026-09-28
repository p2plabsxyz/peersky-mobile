import { NativeModules, Platform, Share } from 'react-native'

// iOS draws the share sheet header from the item it is given. A bare string
// gives it nothing, and a hyper:// link gives it nothing it can fetch, so it
// falls back to a blank page glyph. The native module presents the same sheet
// through UIActivityItemSource with the app icon attached.
//
// Android already labels a share with the sending app's icon, so it keeps
// using the built-in Share.
const { PeerSkyShare } = NativeModules as {
  PeerSkyShare?: { share: (text: string, title: string) => Promise<{ action: string }> }
}

export function hasNativeShareIcon () {
  return Platform.OS === 'ios' && PeerSkyShare != null
}

/**
 * Shares a link or message. Same shape as Share.share, minus the options
 * nobody here passes.
 */
export async function shareLink ({ message, title = '' }: { message: string, title?: string }) {
  if (!message) return

  if (hasNativeShareIcon()) {
    try {
      await PeerSkyShare?.share(message, title)
      return
    } catch {
      // A build without the native module, or a sheet that could not be
      // presented. The platform share still works and still shares the right
      // link; it just looks plainer.
    }
  }

  await Share.share(title ? { message, title } : { message })
}
