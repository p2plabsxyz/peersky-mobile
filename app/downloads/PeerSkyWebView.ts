import type { ComponentProps } from 'react'
import { Platform, requireNativeComponent, UIManager } from 'react-native'
import { WebView } from 'react-native-webview'

type NativeConfig = NonNullable<ComponentProps<typeof WebView>['nativeConfig']>
type NativeWebViewComponent = NonNullable<NativeConfig['component']>

function loadPeerSkyWebView (): NativeWebViewComponent | null {
  if (
    !['android', 'ios'].includes(Platform.OS) ||
    !UIManager.hasViewManagerConfig('PeerSkyWebView')
  ) return null

  try {
    return requireNativeComponent('PeerSkyWebView') as NativeWebViewComponent
  } catch (error) {
    console.warn('PeerSkyWebView native component is unavailable:', error)
    return null
  }
}

const peerSkyWebView = loadPeerSkyWebView()

export const peerSkyWebViewNativeConfig: NativeConfig | undefined = peerSkyWebView
  ? { component: peerSkyWebView }
  : undefined
