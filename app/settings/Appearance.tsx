import { StyleSheet, Switch, Text, View } from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import type {
  AddressBarPosition,
  BrowserTheme
} from './useBrowserPreferences'
import {
  ChoiceGroup,
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'

type AppearanceProps = {
  addressBarPosition: AddressBarPosition
  persistenceError: string | null
  showFullAddress: boolean
  theme: BrowserTheme
  onAddressBarPositionChange: (position: AddressBarPosition) => void
  onShowFullAddressChange: (enabled: boolean) => void
  onThemeChange: (theme: BrowserTheme) => void
}

export function Appearance ({
  addressBarPosition,
  persistenceError,
  showFullAddress,
  theme,
  onAddressBarPositionChange,
  onShowFullAddressChange,
  onThemeChange
}: AppearanceProps) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {persistenceError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError}</Text>
        </View>
      )}

      <SettingsSection title='Theme'>
        <ChoiceGroup
          options={[
            { id: 'system', title: 'System default' },
            { id: 'light', title: 'Light' },
            { id: 'dark', title: 'Dark' }
          ]}
          selected={theme}
          onSelect={onThemeChange}
        />
      </SettingsSection>

      <SettingsSection title='Address bar'>
        <ChoiceGroup
          options={[
            { id: 'top', title: 'Top' },
            { id: 'bottom', title: 'Bottom' }
          ]}
          selected={addressBarPosition}
          onSelect={onAddressBarPositionChange}
        />
        <View style={[styles.divider, isDark ? styles.dividerDark : null]} />
        <View style={styles.settingRow}>
          <SettingCopy
            title='Show full website address'
            description='Show the complete URL instead of only the site address.'
          />
          <Switch
            accessibilityLabel='Show full website address'
            value={showFullAddress}
            onValueChange={onShowFullAddressChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={showFullAddress ? '#1f6fd1' : '#ffffff'}
          />
        </View>
      </SettingsSection>
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
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    padding: 16
  },
  divider: {
    backgroundColor: '#e6ecf5',
    height: 1,
    marginLeft: 16
  },
  dividerDark: {
    backgroundColor: BROWSER_PALETTES.dark.border
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
