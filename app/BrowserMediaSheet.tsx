import { type ReactNode, useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import DisplayIcon from '../assets/icons/bootstrap/display.svg'
import DownloadIcon from '../assets/icons/bootstrap/download.svg'
import PlusIcon from '../assets/icons/bootstrap/plus-lg.svg'
import ShareIcon from '../assets/icons/bootstrap/arrow-bar-up.svg'
import XIcon from '../assets/icons/bootstrap/x-circle.svg'
import { BROWSER_PALETTES } from './browser-appearance.mjs'
import { t } from './i18n/i18n.mjs'
import { WEBVIEW_DECELERATION_RATE } from './webview-scroll.mjs'
import { isDownloadableBrowserMediaUrl } from './browser-media.mjs'
import { MODAL_ORIENTATIONS } from './modal-orientations'

const MEDIA_ACTION_ICON_STROKE_WIDTH = 0.35

export type BrowserMediaTarget = {
  kind: 'image' | 'video' | 'link'
  mediaUrl: string | null
  linkUrl: string | null
  title: string
}

type BrowserMediaSheetProps = {
  isDark: boolean
  target: BrowserMediaTarget | null
  onClose: () => void
  onDownload: (url: string) => void
  onOpenInBackgroundTab: (url: string, title: string) => void
  onOpenInNewTab: (url: string) => void
  onShare: (url: string, title: string) => void
}

export function BrowserMediaSheet ({
  isDark,
  target,
  onClose,
  onDownload,
  onOpenInBackgroundTab,
  onOpenInNewTab,
  onShare
}: BrowserMediaSheetProps) {
  const [previewVisible, setPreviewVisible] = useState(false)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    if (!target) setPreviewVisible(false)
  }, [target])

  if (!target) return null

  // Each line is written out whole for each kind, so it reads as a sentence
  // to whoever translates it.
  const isLink = target.kind === 'link'
  const isVideo = target.kind === 'video'
  const previewLabel = isVideo ? t('Preview video') : t('Preview image')
  const primaryUrl = target.kind === 'link' ? target.linkUrl : target.mediaUrl
  const iconColor = isDark ? BROWSER_PALETTES.dark.text : BROWSER_PALETTES.light.text

  if (previewVisible && target.mediaUrl) {
    return (
      <Modal
        supportedOrientations={MODAL_ORIENTATIONS}
        animationType='fade'
        visible={true}
        onRequestClose={() => setPreviewVisible(false)}
      >
        {/* A Modal is its own root view on iOS, so a bare SafeAreaView inside
            it reports no top inset and the close button sat under the status
            bar. Its own provider gives it real insets. */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={[styles.preview, isDark ? darkStyles.preview : null]}>
          <View style={[styles.previewHeader, isDark ? darkStyles.border : null]}>
            <Text numberOfLines={1} style={[styles.previewTitle, isDark ? darkStyles.primaryText : null]}>
              {target.title || previewLabel}
            </Text>
            <Pressable
              accessibilityLabel={t('Close media preview')}
              accessibilityRole='button'
              hitSlop={10}
              onPress={() => setPreviewVisible(false)}
            >
              <XIcon width={22} height={22} color={iconColor} stroke={iconColor} strokeWidth={MEDIA_ACTION_ICON_STROKE_WIDTH} />
            </Pressable>
          </View>
          <WebView
            javaScriptEnabled={false}
            originWhitelist={['http://*', 'https://*']}
            // Left unset, a swipe stops dead on iOS.
            decelerationRate={WEBVIEW_DECELERATION_RATE}
            source={{ uri: target.mediaUrl }}
            style={styles.previewWebView}
          />
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    )
  }

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      transparent={true}
      visible={true}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right']}>
        <Pressable accessibilityLabel={t('Close media actions')} style={styles.backdrop} onPress={onClose} />
        {/* The sheet reaches the bottom edge, under the home indicator or the
            navigation bar, and only its rows step clear of them. */}
        <View style={[styles.sheet, isDark ? darkStyles.sheet : null, { paddingBottom: 26 + insets.bottom }]}>
          <View style={styles.header}>
            <View style={styles.targetDetails}>
              <Text numberOfLines={1} style={[styles.title, isDark ? darkStyles.primaryText : null]}>
                {target.title || (isLink ? t('Link') : isVideo ? t('Video') : t('Image'))}
              </Text>
              <Text numberOfLines={1} style={[styles.url, isDark ? darkStyles.secondaryText : null]}>
                {primaryUrl}
              </Text>
            </View>
            <Pressable accessibilityLabel={t('Close media actions')} accessibilityRole='button' hitSlop={10} onPress={onClose}>
              <XIcon width={20} height={20} color={iconColor} stroke={iconColor} strokeWidth={MEDIA_ACTION_ICON_STROKE_WIDTH} />
            </Pressable>
          </View>

          {primaryUrl && (
            <Action
              icon={<PlusIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={isLink ? t('Open link in new tab') : isVideo ? t('Open video in new tab') : t('Open image in new tab')}
              onPress={() => onOpenInNewTab(primaryUrl)}
            />
          )}
          {primaryUrl && (
            <Action
              icon={<PlusIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={isLink ? t('Open link in background tab') : isVideo ? t('Open video in background tab') : t('Open image in background tab')}
              onPress={() => onOpenInBackgroundTab(primaryUrl, target.title)}
            />
          )}
          {target.mediaUrl && (
            <Action
              icon={<DisplayIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={previewLabel}
              onPress={() => setPreviewVisible(true)}
            />
          )}
          {target.mediaUrl && target.linkUrl && target.linkUrl !== target.mediaUrl && (
            <Action
              icon={<PlusIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={t('Open link in new tab')}
              onPress={() => onOpenInNewTab(target.linkUrl as string)}
            />
          )}
          {primaryUrl && isDownloadableBrowserMediaUrl(primaryUrl) && (
            <Action
              icon={<DownloadIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={isLink ? t('Download link') : isVideo ? t('Download video') : t('Download image')}
              onPress={() => {
                onClose()
                onDownload(primaryUrl)
              }}
            />
          )}
          {primaryUrl && (
            <Action
              icon={<ShareIcon width={20} height={20} color={iconColor} stroke={iconColor} strokeWidth={MEDIA_ACTION_ICON_STROKE_WIDTH} />}
              isDark={isDark}
              label={isLink ? t('Share link') : isVideo ? t('Share video link') : t('Share image link')}
              onPress={() => {
                onClose()
                onShare(primaryUrl, target.title)
              }}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

function Action ({
  icon,
  isDark,
  label,
  onPress
}: {
  icon: ReactNode
  isDark: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole='button'
      style={({ pressed }) => [
        styles.action,
        isDark ? darkStyles.action : null,
        pressed ? styles.pressed : null
      ]}
      onPress={onPress}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={[styles.actionText, isDark ? darkStyles.primaryText : null]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(21, 24, 33, 0.38)'
  },
  sheet: {
    backgroundColor: BROWSER_PALETTES.light.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 4,
    paddingBottom: 26,
    paddingHorizontal: 16,
    paddingTop: 18
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    paddingBottom: 12,
    paddingHorizontal: 4
  },
  targetDetails: {
    flex: 1
  },
  title: {
    color: BROWSER_PALETTES.light.text,
    fontSize: 16,
    fontWeight: '800'
  },
  url: {
    color: BROWSER_PALETTES.light.mutedText,
    fontSize: 12,
    marginTop: 3
  },
  action: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: 12
  },
  actionIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36
  },
  actionText: {
    color: BROWSER_PALETTES.light.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '700'
  },
  pressed: {
    opacity: 0.62
  },
  preview: {
    backgroundColor: BROWSER_PALETTES.light.surface,
    flex: 1
  },
  previewHeader: {
    alignItems: 'center',
    borderBottomColor: BROWSER_PALETTES.light.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 18
  },
  previewTitle: {
    color: BROWSER_PALETTES.light.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '800'
  },
  previewWebView: {
    flex: 1
  }
})

const darkStyles = StyleSheet.create({
  sheet: {
    backgroundColor: BROWSER_PALETTES.dark.surface
  },
  primaryText: {
    color: BROWSER_PALETTES.dark.text
  },
  secondaryText: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  action: {
    backgroundColor: 'transparent'
  },
  preview: {
    backgroundColor: BROWSER_PALETTES.dark.surface
  },
  border: {
    borderBottomColor: BROWSER_PALETTES.dark.border
  }
})
