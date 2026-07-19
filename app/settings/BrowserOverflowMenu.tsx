import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type BrowserOverflowMenuProps = {
  visible: boolean
  onClose: () => void
  onOpenSettings: () => void
  onShow: () => void
}

export function BrowserOverflowMenu ({
  visible,
  onClose,
  onOpenSettings,
  onShow
}: BrowserOverflowMenuProps) {
  return (
    <>
      <Pressable
        accessibilityLabel='Open browser menu'
        accessibilityRole='button'
        style={styles.trigger}
        onPress={onShow}
      >
        <View style={styles.dots}>
          <View style={styles.dot} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </Pressable>

      <Modal
        animationType='fade'
        transparent={true}
        visible={visible}
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
          <Pressable accessibilityLabel='Close browser menu' style={styles.backdrop} onPress={onClose} />
          <View style={styles.menu}>
            <Pressable
              accessibilityRole='button'
              style={({ pressed }) => [styles.menuItem, pressed ? styles.pressed : null]}
              onPress={onOpenSettings}
            >
              <Text style={styles.menuItemText}>Settings</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    backgroundColor: '#e8f0fb',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 34
  },
  dots: {
    gap: 3
  },
  dot: {
    backgroundColor: '#1f2a44',
    borderRadius: 2,
    height: 4,
    width: 4
  },
  overlay: {
    flex: 1
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(21, 24, 33, 0.16)'
  },
  menu: {
    alignSelf: 'flex-end',
    backgroundColor: '#ffffff',
    borderColor: '#dbe3ef',
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
    marginRight: 12,
    marginTop: 54,
    minWidth: 180,
    overflow: 'hidden',
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10
  },
  menuItem: {
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18
  },
  pressed: {
    backgroundColor: '#edf5ff'
  },
  menuItemText: {
    color: '#1f2a44',
    fontSize: 15,
    fontWeight: '700'
  }
})
