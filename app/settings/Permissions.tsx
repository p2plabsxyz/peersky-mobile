import { StyleSheet, Text, View } from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import type { ExternalLinkBehavior } from './useBrowserPreferences'
import {
  ChoiceGroup,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'

type PermissionsProps = {
  externalLinkBehavior: ExternalLinkBehavior
  persistenceError: string | null
  onExternalLinkBehaviorChange: (behavior: ExternalLinkBehavior) => void
}

export function Permissions ({
  externalLinkBehavior,
  persistenceError,
  onExternalLinkBehaviorChange
}: PermissionsProps) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {persistenceError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError}</Text>
        </View>
      )}

      <SettingsSection title='External app links'>
        <ChoiceGroup
          options={[
            { id: 'ask', title: 'Ask every time' },
            { id: 'allow', title: 'Always allow' },
            { id: 'block', title: 'Block external links' }
          ]}
          selected={externalLinkBehavior}
          onSelect={onExternalLinkBehaviorChange}
        />
      </SettingsSection>

      <View style={styles.notice}>
        <Text style={[styles.noticeText, isDark ? styles.noticeTextDark : null]}>
          Controls links that open email (mailto:), phone (tel:), messaging (sms:), and map (geo:) apps. Web and Hyper links continue to open in PeerSky. Always allow skips confirmation, so only enable it if you trust the sites you visit.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1
  },
  pageDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  notice: {
    paddingHorizontal: 20,
    paddingVertical: 16
  },
  noticeText: {
    color: '#687086',
    fontSize: 13,
    lineHeight: 18
  },
  noticeTextDark: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  errorBanner: {
    backgroundColor: '#fff1f3',
    borderBottomColor: '#efb8c2',
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  errorText: {
    color: '#8f2940',
    fontSize: 13,
    lineHeight: 18
  }
})
