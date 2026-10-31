import { type ReactNode, useRef } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import DisplayIcon from '../assets/icons/bootstrap/display.svg'
import FileTextIcon from '../assets/icons/bootstrap/file-text.svg'
import PeopleIcon from '../assets/icons/bootstrap/people.svg'
import XIcon from '../assets/icons/bootstrap/x-circle.svg'
import { BROWSER_PALETTES } from './browser-appearance.mjs'
import { t } from './i18n/i18n.mjs'
import { MODAL_ORIENTATIONS } from './modal-orientations'

const ICON_STROKE_WIDTH = 0.35

type P2pmdShareSheetProps = {
  visible: boolean
  isDark: boolean
  // Whether the note reads as a deck: only then is there something to export
  // as slides.
  slides: boolean
  onClose: () => void
  // iOS only: the sheet has finished leaving, so a share sheet can open.
  onDismissed?: () => void
  onShareInvite: () => void
  onExportPdf: () => void
  onExportSlides: () => void
}

// What the share button in a note's header offers: the note's key, as it
// always did, and the note itself as a PDF or a slides file, as the desktop's
// Export menu does.
export function P2pmdShareSheet ({
  visible,
  isDark,
  slides,
  onClose,
  onDismissed,
  onShareInvite,
  onExportPdf,
  onExportSlides
}: P2pmdShareSheetProps) {
  const insets = useSafeAreaInsets()
  // Kept mounted so iOS can say when it has gone, with its rows as they were
  // while it fades out.
  const shownSlides = useRef(slides)
  if (visible) shownSlides.current = slides

  const iconColor = isDark ? BROWSER_PALETTES.dark.text : BROWSER_PALETTES.light.text

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      transparent={true}
      visible={visible}
      onDismiss={onDismissed}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right']}>
        <Pressable accessibilityLabel={t('Close')} style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, isDark ? darkStyles.sheet : null, { paddingBottom: 26 + insets.bottom }]}>
          <View style={styles.header}>
            <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>{t('Share note')}</Text>
            <Pressable accessibilityLabel={t('Close')} accessibilityRole='button' hitSlop={10} onPress={onClose}>
              <XIcon width={20} height={20} color={iconColor} stroke={iconColor} strokeWidth={ICON_STROKE_WIDTH} />
            </Pressable>
          </View>
          <Action
            icon={<PeopleIcon width={20} height={20} color={iconColor} />}
            isDark={isDark}
            label={t('Share invite')}
            onPress={onShareInvite}
          />
          <Action
            icon={<FileTextIcon width={20} height={20} color={iconColor} />}
            isDark={isDark}
            label={t('Export PDF')}
            onPress={onExportPdf}
          />
          {shownSlides.current && (
            <Action
              icon={<DisplayIcon width={20} height={20} color={iconColor} />}
              isDark={isDark}
              label={t('Export slides')}
              onPress={onExportSlides}
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
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
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
  title: {
    color: BROWSER_PALETTES.light.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '800'
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
  }
})

const darkStyles = StyleSheet.create({
  sheet: {
    backgroundColor: BROWSER_PALETTES.dark.surface
  },
  primaryText: {
    color: BROWSER_PALETTES.dark.text
  }
})
