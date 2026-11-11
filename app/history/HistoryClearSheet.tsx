import { useRef } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import XIcon from '../../assets/icons/bootstrap/x-circle.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { t } from '../i18n/i18n.mjs'
import { MODAL_ORIENTATIONS } from '../modal-orientations'

const ICON_STROKE_WIDTH = 0.35

export type HistoryClearChoice = {
  key: string
  label: string
  // How many pages it clears. A choice with none is shown, but can't be picked.
  count: number
}

type HistoryClearSheetProps = {
  choices: HistoryClearChoice[]
  isDark: boolean
  visible: boolean
  onChoose: (key: string) => void
  onClose: () => void
}

// What the trash button in History offers: a stretch of time to clear, as
// Safari and Firefox do. Android's alerts take three buttons at most, so it
// is a sheet.
export function HistoryClearSheet ({
  choices,
  isDark,
  visible,
  onChoose,
  onClose
}: HistoryClearSheetProps) {
  const insets = useSafeAreaInsets()
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  // Its rows as they were while it fades out, not the ones left once a
  // choice has cleared some.
  const shown = useRef(choices)
  if (visible) shown.current = choices

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right']}>
        <Pressable accessibilityLabel={t('Close')} style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.surface, paddingBottom: 18 + insets.bottom }]}>
          <View style={styles.header}>
            <Text accessibilityRole='header' style={[styles.title, { color: palette.text }]}>
              {t('Clear browsing history')}
            </Text>
            <Pressable accessibilityLabel={t('Close')} accessibilityRole='button' hitSlop={10} onPress={onClose}>
              <XIcon width={20} height={20} color={palette.text} stroke={palette.text} strokeWidth={ICON_STROKE_WIDTH} />
            </Pressable>
          </View>
          {shown.current.map((choice) => {
            const empty = choice.count === 0
            return (
              <Pressable
                key={choice.key}
                accessibilityRole='button'
                accessibilityState={{ disabled: empty }}
                disabled={empty}
                style={({ pressed }) => [styles.choice, empty ? styles.disabled : null, pressed ? styles.pressed : null]}
                onPress={() => onChoose(choice.key)}
              >
                <Text style={[styles.choiceText, { color: palette.text }]}>{choice.label}</Text>
                <Text style={[styles.count, { color: palette.mutedText }]}>{choice.count}</Text>
              </Pressable>
            )
          })}
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
    backgroundColor: 'rgba(21, 24, 33, 0.38)'
  },
  sheet: {
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
    paddingBottom: 8,
    paddingHorizontal: 4
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800'
  },
  choice: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 8
  },
  choiceText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700'
  },
  count: {
    fontSize: 14,
    fontVariant: ['tabular-nums']
  },
  disabled: {
    opacity: 0.4
  },
  pressed: {
    opacity: 0.62
  }
})
