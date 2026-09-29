import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { AppLogo } from '../AppLogo'
import { APP_LOGO_COLORS } from '../app-logo-colors.mjs'
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
  appLogoColor: string
  persistenceError: string | null
  showFullAddress: boolean
  theme: BrowserTheme
  onAddressBarPositionChange: (position: AddressBarPosition) => void
  onAppLogoColorChange: (color: string) => void
  onShowFullAddressChange: (enabled: boolean) => void
  onThemeChange: (theme: BrowserTheme) => void
}

export function Appearance ({
  addressBarPosition,
  appLogoColor,
  persistenceError,
  showFullAddress,
  theme,
  onAddressBarPositionChange,
  onAppLogoColorChange,
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

      {/* Shown large rather than as six coloured dots: the thing being picked
          is the logo, so the logo is what you pick from. */}
      <SettingsSection title='Logo'>
        <View style={styles.logoRow}>
          {APP_LOGO_COLORS.map((color) => {
            const selected = color.id === appLogoColor
            return (
              <Pressable
                key={color.id}
                accessibilityRole='button'
                accessibilityLabel={`${color.title} logo`}
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.logoOption, pressed ? styles.logoPressed : null]}
                onPress={() => onAppLogoColorChange(color.id)}
              >
                <View style={[
                  styles.logoRing,
                  selected ? styles.logoRingSelected : null,
                  isDark ? styles.logoRingDark : null,
                  selected && isDark ? styles.logoRingSelectedDark : null
                ]}>
                  <AppLogo color={color.id} size={48} />
                </View>
                <Text style={[styles.logoLabel, isDark ? styles.logoLabelDark : null]}>
                  {color.title}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </SettingsSection>
    </View>
  )
}

const styles = StyleSheet.create({
  logoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
    padding: 16
  },
  logoOption: { alignItems: 'center', gap: 6 },
  logoPressed: { opacity: 0.7 },
  logoRing: {
    borderColor: 'transparent',
    borderRadius: 32,
    borderWidth: 2,
    padding: 3
  },
  logoRingDark: { borderColor: 'transparent' },
  logoRingSelected: { borderColor: '#1f6fd1' },
  logoRingSelectedDark: { borderColor: '#7eb2ee' },
  logoLabel: { color: '#687086', fontSize: 12, fontWeight: '700' },
  logoLabelDark: { color: '#aab4c8' },
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
