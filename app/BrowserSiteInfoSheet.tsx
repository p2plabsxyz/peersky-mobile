import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BROWSER_PALETTES } from './browser-appearance.mjs'
import { describeSiteSecurity, getSiteSecurity, SITE_SECURITY } from './site-security.mjs'
import { MODAL_ORIENTATIONS } from './modal-orientations'
import ShieldLockIcon from '../assets/icons/bootstrap/shield-lock.svg'
import ShieldSlashIcon from '../assets/icons/bootstrap/shield-slash.svg'

type BrowserSiteInfoSheetProps = {
  blockingEnabled: boolean
  isDark: boolean
  url: string
  visible: boolean
  onClose: () => void
  onOpenPrivacySettings: () => void
}

/**
 * What the shield in the address bar means, in words.
 *
 * Content blocking is stated rather than counted. On iOS the rules are compiled
 * into WebKit, which refuses those requests inside the engine and reports
 * nothing back, and on Android the native client answers them without telling
 * anyone. Neither platform hands out a number, so a number here would be
 * invented, and an invented one on a privacy screen is worse than none.
 */
export function BrowserSiteInfoSheet ({
  blockingEnabled,
  isDark,
  url,
  visible,
  onClose,
  onOpenPrivacySettings
}: BrowserSiteInfoSheetProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const security = getSiteSecurity(url)
  const { title, body } = describeSiteSecurity(security)
  const insecure = security === SITE_SECURITY.INSECURE

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='fade'
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
        <Pressable accessibilityLabel='Close connection information' style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
          <View style={styles.row}>
            {insecure
              ? <ShieldSlashIcon width={22} height={22} color='#c2563f' />
              : <ShieldLockIcon width={22} height={22} color={palette.selectedControl} />}
            <View style={styles.copy}>
              <Text style={[styles.title, { color: insecure ? '#c2563f' : palette.text }]}>{title}</Text>
              <Text style={[styles.body, { color: palette.mutedText }]}>{body}</Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.border }]} />

          <View style={styles.row}>
            <ShieldLockIcon
              width={22}
              height={22}
              color={blockingEnabled ? palette.selectedControl : palette.mutedText}
            />
            <View style={styles.copy}>
              <Text style={[styles.title, { color: palette.text }]}>
                {blockingEnabled ? 'Ads and trackers are blocked' : 'Ads and trackers are not blocked'}
              </Text>
              <Text style={[styles.body, { color: palette.mutedText }]}>
                {blockingEnabled
                  ? 'EasyList and EasyPrivacy rules are applied by the engine itself, so a page cannot load them in the first place.'
                  : 'Protection is switched off, so pages can load ads and trackers.'}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityRole='button'
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
            onPress={onOpenPrivacySettings}
          >
            <Text style={[styles.actionText, { color: palette.selectedControl }]}>Privacy settings</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null]}
            onPress={onClose}
          >
            <Text style={[styles.actionText, { color: palette.mutedText }]}>Close</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    gap: 16,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: 20
  },
  row: { flexDirection: 'row', gap: 14 },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '800' },
  body: { fontSize: 13, lineHeight: 19 },
  divider: { height: StyleSheet.hairlineWidth },
  action: { justifyContent: 'center', minHeight: 46 },
  actionPressed: { opacity: 0.65 },
  actionText: { fontSize: 15, fontWeight: '700' }
})
