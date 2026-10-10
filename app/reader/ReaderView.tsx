import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import CloseIcon from '../../assets/icons/bootstrap/x-lg.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { peerSkyWebViewNativeConfig } from '../downloads/PeerSkyWebView'
import { MODAL_ORIENTATIONS } from '../modal-orientations'
import { createReaderHtml, READER_TEXT_SCALES } from './reader-mode.mjs'

export type ReaderArticle = {
  ok: boolean
  title: string
  byline: string
  siteName: string
  lang: string
  dir: 'ltr' | 'rtl'
  html: string
}

/**
 * The article from the page, on its own: no menus, adverts or pop-ups, in one
 * column at a size you choose. It is drawn over the tab, so closing it leaves
 * the page exactly where it was. A link in it opens in the tab.
 */
export function ReaderView ({
  article,
  incognitoSession,
  isDark,
  pageUrl,
  textScale,
  onClose,
  onOpenLink,
  onTextScaleChange
}: {
  article: ReaderArticle | null
  // An incognito tab's store, so pictures in the article load the way the
  // tab's own did and leave nothing behind in the normal one.
  incognitoSession?: string | null
  isDark: boolean
  pageUrl: string
  textScale: number
  onClose: () => void
  onOpenLink: (url: string) => void
  onTextScaleChange: (scale: number) => void
}) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const scaleIndex = Math.max(READER_TEXT_SCALES.indexOf(textScale), 0)
  const nativeConfig = peerSkyWebViewNativeConfig && incognitoSession
    ? {
        ...peerSkyWebViewNativeConfig,
        props: Object.assign({}, peerSkyWebViewNativeConfig.props, { incognitoSession })
      }
    : peerSkyWebViewNativeConfig
  const page = pageUrl.split('#')[0]

  return (
    <Modal
      animationType='slide'
      supportedOrientations={MODAL_ORIENTATIONS}
      visible={article !== null}
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: isDark ? '#16181d' : '#fbfbf9' }]}>
        <View style={[styles.header, { borderBottomColor: palette.border }]}>
          <Pressable
            accessibilityLabel='Close Reader view'
            accessibilityRole='button'
            hitSlop={10}
            style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
            onPress={onClose}
          >
            <CloseIcon width={18} height={18} color={palette.text} />
          </Pressable>
          <Text numberOfLines={1} style={[styles.heading, { color: palette.mutedText }]}>Reader view</Text>
          <Pressable
            accessibilityLabel='Smaller text'
            accessibilityRole='button'
            accessibilityState={{ disabled: scaleIndex === 0 }}
            disabled={scaleIndex === 0}
            hitSlop={6}
            style={({ pressed }) => [styles.button, pressed ? styles.pressed : null, scaleIndex === 0 ? styles.disabled : null]}
            onPress={() => onTextScaleChange(READER_TEXT_SCALES[scaleIndex - 1])}
          >
            <Text style={[styles.smallA, { color: palette.text }]}>A</Text>
          </Pressable>
          <Pressable
            accessibilityLabel='Larger text'
            accessibilityRole='button'
            accessibilityState={{ disabled: scaleIndex === READER_TEXT_SCALES.length - 1 }}
            disabled={scaleIndex === READER_TEXT_SCALES.length - 1}
            hitSlop={6}
            style={({ pressed }) => [
              styles.button,
              pressed ? styles.pressed : null,
              scaleIndex === READER_TEXT_SCALES.length - 1 ? styles.disabled : null
            ]}
            onPress={() => onTextScaleChange(READER_TEXT_SCALES[scaleIndex + 1])}
          >
            <Text style={[styles.largeA, { color: palette.text }]}>A</Text>
          </Pressable>
        </View>
        {article && (
          <WebView
            javaScriptEnabled={false}
            nativeConfig={nativeConfig}
            originWhitelist={['*']}
            source={{ html: createReaderHtml(article, { isDark, textScale }), baseUrl: pageUrl }}
            style={styles.page}
            onShouldStartLoadWithRequest={(request) => {
              // The reader page itself, and a jump within it.
              if (request.url === 'about:blank' || request.url.split('#')[0] === page) return true
              if (/^(?:https?|hyper):\/\//i.test(request.url)) onOpenLink(request.url)
              return false
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 6,
    minHeight: 52,
    paddingHorizontal: 10
  },
  heading: { flex: 1, fontSize: 14, fontWeight: '700', paddingHorizontal: 6 },
  button: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', minWidth: 36 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.35 },
  smallA: { fontSize: 14, fontWeight: '700' },
  largeA: { fontSize: 20, fontWeight: '700' },
  page: { backgroundColor: 'transparent', flex: 1 }
})
