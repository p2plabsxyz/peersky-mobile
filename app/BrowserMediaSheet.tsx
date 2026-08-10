import { type ReactNode, useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import DisplayIcon from '../assets/icons/bootstrap/display.svg'
import DownloadIcon from '../assets/icons/bootstrap/download.svg'
import PlusIcon from '../assets/icons/bootstrap/plus-lg.svg'
import ShareIcon from '../assets/icons/bootstrap/share.svg'
import XIcon from '../assets/icons/bootstrap/x-lg.svg'
import { BROWSER_PALETTES } from './browser-appearance.mjs'
import { isDownloadableBrowserMediaUrl } from './browser-media.mjs'

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

  useEffect(() => {
    if (!target) setPreviewVisible(false)
  }, [target])

  if (!target) return null

  const mediaLabel = target.kind === 'video' ? 'video' : 'image'
  const primaryUrl = target.kind === 'link' ? target.linkUrl : target.mediaUrl
  const iconColor = isDark ? BROWSER_PALETTES.dark.text : BROWSER_PALETTES.light.text

  if (previewVisible && target.mediaUrl) {
    return (
      <Modal
        animationType='fade'
        visible={true}
        onRequestClose={() => setPreviewVisible(false)}
      >
        <SafeAreaView style={[styles.preview, isDark ? darkStyles.preview : null]}>
          <View style={[styles.previewHeader, isDark ? darkStyles.border : null]}>
            <Text numberOfLines={1} style={[styles.previewTitle, isDark ? darkStyles.primaryText : null]}>
              {target.title || `Preview ${mediaLabel}`}
            </Text>
            <Pressable
              accessibilityLabel='Close media preview'
              accessibilityRole='button'
              hitSlop={10}
              onPress={() => setPreviewVisible(false)}
            >
              <XIcon width={22} height={22} color={iconColor} />
            </Pressable>
          </View>
          <WebView
            javaScriptEnabled={false}
            originWhitelist={['http://*', 'https://*']}
            source={{ uri: target.mediaUrl }}
            style={styles.previewWebView}
          />
        </SafeAreaView>
      </Modal>
    )
  }

  return (
    <Modal
      animationType='fade'
      transparent={true}
      visible={true}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <Pressable accessibilityLabel='Close media actions' style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, isDark ? darkStyles.sheet : null]}>
          <View style={styles.header}>
            <View style={styles.targetDetails}>
              <Text numberOfLines={1} style={[styles.title, isDark ? darkStyles.primaryText : null]}>
                {target.title || (target.kind === 'link' ? 'Link' : `${mediaLabel[0].toUpperCase()}${mediaLabel.slice(1)}`)}
              </Text>
              <Text numberOfLines={1} style={[styles.url, isDark ? darkStyles.secondaryText : null]}>
                {primaryUrl}
              </Text>
            </View>
            <Pressable accessibilityLabel='Close media actions' accessibilityRole='button' hitSlop={10} onPress={onClose}>
              <XIcon width={20} height={20} color={iconColor} />
            </Pressable>
          </View>

          {primaryUrl && (
            <Action
              icon={<PlusIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={`Open ${target.kind === 'link' ? 'link' : mediaLabel} in new tab`}
              onPress={() => {
                onClose()
                onOpenInNewTab(primaryUrl)
              }}
            />
          )}
          {primaryUrl && (
            <Action
              icon={<PlusIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={`Open ${target.kind === 'link' ? 'link' : mediaLabel} in background tab`}
              onPress={() => {
                onClose()
                onOpenInBackgroundTab(primaryUrl, target.title)
              }}
            />
          )}
          {target.mediaUrl && (
            <Action
              icon={<DisplayIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={`Preview ${mediaLabel}`}
              onPress={() => setPreviewVisible(true)}
            />
          )}
          {target.mediaUrl && target.linkUrl && target.linkUrl !== target.mediaUrl && (
            <Action
              icon={<PlusIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label='Open link in new tab'
              onPress={() => {
                onClose()
                onOpenInNewTab(target.linkUrl as string)
              }}
            />
          )}
          {primaryUrl && isDownloadableBrowserMediaUrl(primaryUrl) && (
            <Action
              icon={<DownloadIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={`Download ${target.kind === 'link' ? 'link' : mediaLabel}`}
              onPress={() => {
                onClose()
                onDownload(primaryUrl)
              }}
            />
          )}
          {primaryUrl && (
            <Action
              icon={<ShareIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={`Share ${target.kind === 'link' ? 'link' : `${mediaLabel} link`}`}
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
