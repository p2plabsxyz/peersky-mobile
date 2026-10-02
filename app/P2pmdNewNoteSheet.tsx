import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BROWSER_PALETTES } from './browser-appearance.mjs'
import { MODAL_ORIENTATIONS } from './modal-orientations'
import GlobeIcon from '../assets/icons/bootstrap/globe.svg'
import ShieldLockIcon from '../assets/icons/bootstrap/shield-lock.svg'

type P2pmdNewNoteSheetProps = {
  visible: boolean
  isDark: boolean
  onCreate: (isPrivate: boolean) => void
  onClose: () => void
}

const CHOICES = [
  {
    isPrivate: true,
    title: 'Private',
    detail: 'Only people you send the key to can open it. Your other devices can host it too.',
    Icon: ShieldLockIcon
  },
  {
    isPrivate: false,
    title: 'Public',
    detail: 'Anyone with the key can open it, and the computers that help peers find each other see the key. Only this phone can host it.',
    Icon: GlobeIcon
  }
]

// The one connection choice worth asking about on a phone. The desktop also
// offers UDP, a host and a port. Every new note starts private, whatever the
// last one was, the same as on the desktop.
export function P2pmdNewNoteSheet ({ visible, isDark, onCreate, onClose }: P2pmdNewNoteSheetProps) {
  const [isPrivate, setIsPrivate] = useState(true)
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light

  useEffect(() => {
    if (visible) setIsPrivate(true)
  }, [visible])

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <Pressable accessibilityLabel='Close' style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
          <Text style={[styles.title, { color: palette.text }]}>New note</Text>
          <View accessibilityRole='radiogroup' style={styles.choices}>
            {CHOICES.map(({ isPrivate: value, title, detail, Icon }) => {
              const selected = value === isPrivate
              const color = selected ? palette.accent : palette.border
              return (
                <Pressable
                  key={title}
                  accessibilityRole='radio'
                  accessibilityState={{ checked: selected }}
                  onPress={() => setIsPrivate(value)}
                  style={({ pressed }) => [
                    styles.choice,
                    { borderColor: color },
                    selected ? { backgroundColor: palette.selectedBackground } : null,
                    pressed ? styles.pressed : null
                  ]}
                >
                  <Icon width={20} height={20} color={selected ? palette.accent : palette.mutedText} />
                  <View style={styles.choiceCopy}>
                    <Text style={[styles.choiceTitle, { color: palette.text }]}>{title}</Text>
                    <Text style={[styles.choiceDetail, { color: palette.mutedText }]}>{detail}</Text>
                  </View>
                  <View style={[styles.radio, { borderColor: color }]}>
                    {selected ? <View style={[styles.radioDot, { backgroundColor: palette.accent }]} /> : null}
                  </View>
                </Pressable>
              )
            })}
          </View>
          <Pressable
            accessibilityRole='button'
            onPress={() => onCreate(isPrivate)}
            style={({ pressed }) => [styles.primary, pressed ? styles.pressed : null]}
          >
            <Text style={styles.primaryText}>Create note</Text>
          </Pressable>
          <Pressable accessibilityRole='button' hitSlop={8} onPress={onClose} style={styles.cancel}>
            <Text style={[styles.cancelText, { color: palette.mutedText }]}>Cancel</Text>
          </Pressable>
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
  title: {
    fontSize: 19,
    fontWeight: '800'
  },
  choices: {
    gap: 10
  },
  choice: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  choiceCopy: {
    flex: 1,
    gap: 3
  },
  choiceTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  choiceDetail: {
    fontSize: 13,
    lineHeight: 18
  },
  radio: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22
  },
  radioDot: {
    borderRadius: 5,
    height: 10,
    width: 10
  },
  primary: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 48
  },
  primaryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800'
  },
  cancel: {
    alignSelf: 'center'
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '800'
  },
  pressed: {
    opacity: 0.75
  }
})
