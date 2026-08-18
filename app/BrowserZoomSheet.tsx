import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  BROWSER_PAGE_ZOOMS,
  DEFAULT_BROWSER_PAGE_ZOOM
} from './browser-tabs.mjs'
import { BROWSER_PALETTES } from './browser-appearance.mjs'
import ZoomOutIcon from '../assets/icons/bootstrap/dash-lg.svg'
import ZoomInIcon from '../assets/icons/bootstrap/plus-lg.svg'

type BrowserZoomSheetProps = {
  isDark: boolean
  pageZoom: number
  visible: boolean
  onClose: () => void
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function BrowserZoomSheet ({
  isDark,
  pageZoom,
  visible,
  onClose,
  onReset,
  onZoomIn,
  onZoomOut
}: BrowserZoomSheetProps) {
  const zoomIndex = BROWSER_PAGE_ZOOMS.indexOf(pageZoom)
  const canZoomOut = zoomIndex > 0
  const canZoomIn = zoomIndex >= 0 && zoomIndex < BROWSER_PAGE_ZOOMS.length - 1
  const iconColor = isDark ? BROWSER_PALETTES.dark.text : '#1f2a44'

  return (
    <Modal
      animationType='fade'
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <Pressable accessibilityLabel='Close zoom controls' style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, isDark ? darkStyles.sheet : null]}>
          <View style={styles.header}>
            <Text style={[styles.title, isDark ? darkStyles.primaryText : null]}>Zoom</Text>
            <Pressable accessibilityLabel='Close zoom controls' onPress={onClose}>
              <Text style={[styles.closeText, isDark ? darkStyles.secondaryText : null]}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.controls}>
            <Pressable
              accessibilityLabel='Zoom out'
              accessibilityRole='button'
              accessibilityState={{ disabled: !canZoomOut }}
              disabled={!canZoomOut}
              style={[styles.zoomButton, isDark ? darkStyles.zoomButton : null, !canZoomOut ? styles.disabled : null]}
              onPress={onZoomOut}
            >
              <ZoomOutIcon width={24} height={24} color={iconColor} />
            </Pressable>
            <Text style={[styles.zoomValue, isDark ? darkStyles.primaryText : null]}>{pageZoom}%</Text>
            <Pressable
              accessibilityLabel='Zoom in'
              accessibilityRole='button'
              accessibilityState={{ disabled: !canZoomIn }}
              disabled={!canZoomIn}
              style={[styles.zoomButton, isDark ? darkStyles.zoomButton : null, !canZoomIn ? styles.disabled : null]}
              onPress={onZoomIn}
            >
              <ZoomInIcon width={24} height={24} color={iconColor} />
            </Pressable>
          </View>

          <Pressable
            accessibilityLabel='Reset zoom'
            accessibilityRole='button'
            accessibilityState={{ disabled: pageZoom === DEFAULT_BROWSER_PAGE_ZOOM }}
            disabled={pageZoom === DEFAULT_BROWSER_PAGE_ZOOM}
            style={[styles.resetButton, isDark ? darkStyles.resetButton : null, pageZoom === DEFAULT_BROWSER_PAGE_ZOOM ? styles.disabled : null]}
            onPress={onReset}
          >
            <Text style={[styles.resetText, isDark ? darkStyles.resetText : null]}>Reset to 100%</Text>
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
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    gap: 18,
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 18
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  title: {
    color: '#1f2a44',
    fontSize: 18,
    fontWeight: '800'
  },
  closeText: {
    color: '#687086',
    fontSize: 14,
    fontWeight: '700'
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center'
  },
  zoomButton: {
    alignItems: 'center',
    backgroundColor: '#edf3fb',
    borderRadius: 14,
    height: 54,
    justifyContent: 'center',
    width: 68
  },
  zoomValue: {
    color: '#1f2a44',
    fontSize: 26,
    fontWeight: '900',
    minWidth: 86,
    textAlign: 'center'
  },
  resetButton: {
    alignItems: 'center',
    backgroundColor: '#edf5ff',
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center'
  },
  resetText: {
    color: '#1f6fd1',
    fontSize: 15,
    fontWeight: '800'
  },
  disabled: {
    opacity: 0.45
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
  zoomButton: {
    backgroundColor: BROWSER_PALETTES.dark.button
  },
  resetButton: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  resetText: {
    color: BROWSER_PALETTES.dark.text
  }
})
