import { Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { AppLogo } from '../AppLogo'
import { APP_LOGO_COLORS } from '../app-logo-colors.mjs'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { TOOLBAR_BUTTON_ICONS } from '../toolbar-button-icons'
import { TOOLBAR_BUTTONS } from '../toolbar-button.mjs'
import type {
  AddressBarPosition,
  BrowserTheme,
  ToolbarButton
} from './useBrowserPreferences'
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
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
  toolbarButton: ToolbarButton
  onAddressBarPositionChange: (position: AddressBarPosition) => void
  onAppLogoColorChange: (color: string) => void
  onOpenToolbarButton: () => void
  onShowFullAddressChange: (enabled: boolean) => void
  onThemeChange: (theme: BrowserTheme) => void
}

export function Appearance ({
  addressBarPosition,
  appLogoColor,
  persistenceError,
  showFullAddress,
  theme,
  toolbarButton,
  onAddressBarPositionChange,
  onAppLogoColorChange,
  onOpenToolbarButton,
  onShowFullAddressChange,
  onThemeChange
}: AppearanceProps) {
  const isDark = useSettingsDarkMode()
  const ToolbarIcon = TOOLBAR_BUTTON_ICONS[toolbarButton] || TOOLBAR_BUTTON_ICONS.burn
  const toolbarTitle = TOOLBAR_BUTTONS.find((button) => button.id === toolbarButton)?.title || 'Burn Tabs and Data'

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

      {/* The button in the middle of the bar at the bottom, the burn button
          unless another is chosen. */}
      <SettingsSection title='Toolbar button'>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Toolbar button, ${toolbarTitle}`}
          style={({ pressed }) => [styles.settingRow, pressed ? styles.logoPressed : null]}
          onPress={onOpenToolbarButton}
        >
          <ToolbarIcon width={22} height={22} color={isDark ? '#f1f2f7' : '#1f2a44'} />
          <Text style={[styles.toolbarTitle, isDark ? styles.toolbarTitleDark : null]}>{toolbarTitle}</Text>
          <ChevronRightIcon width={16} height={16} color={isDark ? '#aab4c8' : '#687086'} />
        </Pressable>
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
  toolbarTitle: { color: '#1f2a44', flex: 1, fontSize: 15, fontWeight: '600' },
  toolbarTitleDark: { color: '#f1f2f7' },
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
