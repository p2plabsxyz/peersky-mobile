import { Alert, BackHandler, Platform } from 'react-native'

import { RPC_HYPER_STORAGE_CLEAR_ALL } from '../../backend/rpc/commands.mjs'
import { t } from '../i18n/i18n.mjs'
import { clearChatFileCopies } from '../peerchat/media-save'

type ClearAllResponse = {
  ok: boolean
  cleared?: boolean
  error?: string
  warning?: string
}

type ClearAllOptions = {
  onCallRpc: (command: number) => Promise<ClearAllResponse>
  // Swaps the app for a screen asking for a restart.
  onRestartRequired: () => void
}

// Clear all P2P data, from Settings > P2P Data after it asks, or from the lock
// screen button with no question. The same steps as Remove my data from this
// phone (LinkDevice.tsx). The restart screen goes up before anything is
// removed, since what is on screen belongs to the identity going, and PeerChat
// writes what it holds as it closes. It stays until PeerSky starts again. A
// clear that stops part way is finished by the backend as it starts.
export async function clearAllP2PData ({ onCallRpc, onRestartRequired }: ClearAllOptions) {
  onRestartRequired()
  await new Promise((resolve) => setTimeout(resolve, 300))
  clearChatFileCopies()
  try {
    const response = await onCallRpc(RPC_HYPER_STORAGE_CLEAR_ALL)
    if (!response.ok || !response.cleared) throw new Error(response.error || t('Unable to clear P2P data.'))
    if (response.warning) {
      Alert.alert(t('P2P data cleared'), t('{message}\n\nClose PeerSky and open it again to finish.', { message: response.warning }), [{ text: t('OK') }])
      return
    }
    if (Platform.OS === 'android') BackHandler.exitApp()
  } catch (clearError) {
    Alert.alert(
      t('P2P data was not all cleared'),
      t('{message}\n\nClose PeerSky and open it again to finish.', { message: clearError instanceof Error ? clearError.message : String(clearError) }),
      [{ text: t('OK') }]
    )
  }
}
