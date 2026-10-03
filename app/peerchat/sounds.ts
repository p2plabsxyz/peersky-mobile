import { createAudioPlayer, type AudioSource } from 'expo-audio'

import { playAndroidPeerChatSound } from './background-service'

const SOUND_RELEASE_TIMEOUT_MS = 5000

export function playPeerChatSound (kind: 'send' | 'receive' | 'pop', source: AudioSource | string | number) {
  if (playAndroidPeerChatSound(kind)) return
  let player: ReturnType<typeof createAudioPlayer> | null = null
  let subscription: { remove: () => void } | null = null
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  let released = false

  const release = () => {
    if (released) return
    released = true
    if (releaseTimer) clearTimeout(releaseTimer)
    subscription?.remove()
    try {
      player?.remove()
    } catch {}
  }

  try {
    player = createAudioPlayer(source, {
      keepAudioSessionActive: false,
      updateInterval: 100
    })
    subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) release()
    })
    releaseTimer = setTimeout(release, SOUND_RELEASE_TIMEOUT_MS)
    player.play()
  } catch (error) {
    release()
    console.warn('Unable to play PeerChat sound:', error)
  }
}
