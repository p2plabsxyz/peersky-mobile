import { useEffect, useState } from 'react'
import { Clipboard, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BROWSER_PALETTES } from './browser-appearance.mjs'
import { MODAL_ORIENTATIONS } from './modal-orientations'
import { shareLink } from './share'
import { tapFeedback } from './haptics'
import CheckIcon from '../assets/icons/bootstrap/check2.svg'
import CopyIcon from '../assets/icons/bootstrap/copy.svg'
import ShareIcon from '../assets/icons/bootstrap/share.svg'

type PublishedLinkSheetProps = {
  visible: boolean
  isDark: boolean
  title: string
  message: string
  url: string | null
  shareTitle: string
  onClose: () => void
  onOpen?: (url: string) => void
}

// What publishing hands back. It used to be an alert: tap Copy or Done and the
// link was gone, with nothing on screen to get it back. This stays reachable
// from wherever the thing was published, and it says what to do next.
export function PublishedLinkSheet ({
  visible,
  isDark,
  title,
  message,
  url,
  shareTitle,
  onClose,
  onOpen
}: PublishedLinkSheetProps) {
  const [copied, setCopied] = useState(false)
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light

  useEffect(() => {
    if (!visible) setCopied(false)
  }, [visible, url])

  function copy () {
    if (!url) return
    Clipboard.setString(url)
    tapFeedback()
    setCopied(true)
  }

  function share () {
    if (!url) return
    void shareLink({ title: shareTitle, message: url }).catch(() => {})
  }

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      transparent={true}
      visible={visible && Boolean(url)}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <Pressable accessibilityLabel='Close' style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
          <View style={styles.header}>
            <View style={styles.badge}>
              <CheckIcon width={20} height={20} color='#ffffff' />
            </View>
            <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          </View>
          <Text style={[styles.message, { color: palette.mutedText }]}>{message}</Text>

          <Pressable
            accessibilityHint='Copies the link'
            accessibilityRole='button'
            onPress={copy}
            style={({ pressed }) => [
              styles.linkBox,
              { backgroundColor: palette.selectedBackground },
              pressed ? styles.pressed : null
            ]}
          >
            <Text selectable numberOfLines={3} style={[styles.linkText, { color: palette.text }]}>{url}</Text>
            <Text style={[styles.linkHint, { color: palette.selectedControl }]}>
              {copied ? 'Copied' : 'Tap to copy'}
            </Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole='button'
              onPress={share}
              style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
            >
              <ShareIcon width={17} height={17} color='#ffffff' />
              <Text style={styles.primaryText}>Share</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              onPress={copy}
              style={({ pressed }) => [
                styles.secondary,
                { borderColor: palette.border },
                pressed ? styles.pressed : null
              ]}
            >
              <CopyIcon width={16} height={16} color={palette.text} />
              <Text style={[styles.secondaryText, { color: palette.text }]}>{copied ? 'Copied' : 'Copy link'}</Text>
            </Pressable>
          </View>

          <View style={styles.footer}>
            {onOpen && url
              ? (
                <Pressable accessibilityRole='button' hitSlop={8} onPress={() => onOpen(url)}>
                  <Text style={[styles.footerAction, { color: palette.selectedControl }]}>Open it</Text>
                </Pressable>
                )
              : <View />}
            <Pressable accessibilityRole='button' hitSlop={8} onPress={onClose}>
              <Text style={[styles.footerAction, { color: palette.mutedText }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(21, 24, 33, 0.32)'
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    gap: 14,
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 20
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  badge: {
    alignItems: 'center',
    backgroundColor: '#1f9d55',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32
  },
  title: {
    flex: 1,
    fontSize: 19,
    fontWeight: '800'
  },
  message: {
    fontSize: 14,
    lineHeight: 20
  },
  linkBox: {
    borderRadius: 12,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  linkText: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 13,
    lineHeight: 18
  },
  linkHint: {
    fontSize: 12,
    fontWeight: '800'
  },
  actions: {
    flexDirection: 'row',
    gap: 10
  },
  primary: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800'
  },
  secondary: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '800'
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4
  },
  footerAction: {
    fontSize: 15,
    fontWeight: '800'
  },
  pressed: {
    opacity: 0.75
  }
})
