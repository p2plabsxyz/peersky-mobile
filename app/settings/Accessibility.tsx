import { StyleSheet, Switch, Text, View } from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { WEBSITE_TEXT_SCALES } from './browser-preferences.mjs'
import type { WebsiteTextScale } from './useBrowserPreferences'
import {
  ChoiceGroup,
  SettingCopy,
  SettingsSection,
  useSettingsDarkMode
} from './SettingsUI'

type AccessibilityProps = {
  enforceManualPageZoom: boolean
  persistenceError: string | null
  websiteTextScale: WebsiteTextScale
  onEnforceManualPageZoomChange: (enabled: boolean) => void
  onWebsiteTextScaleChange: (scale: WebsiteTextScale) => void
}

const TEXT_SCALE_OPTIONS = WEBSITE_TEXT_SCALES.map((scale) => ({
  id: scale.toString() as `${WebsiteTextScale}`,
  title: `${scale}%`
}))

export function Accessibility ({
  enforceManualPageZoom,
  persistenceError,
  websiteTextScale,
  onEnforceManualPageZoomChange,
  onWebsiteTextScaleChange
}: AccessibilityProps) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      {persistenceError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{persistenceError}</Text>
        </View>
      )}

      <SettingsSection title='Website text size'>
        <ChoiceGroup
          options={TEXT_SCALE_OPTIONS}
          selected={websiteTextScale.toString() as `${WebsiteTextScale}`}
          onSelect={(scale) => onWebsiteTextScaleChange(Number(scale) as WebsiteTextScale)}
        />
      </SettingsSection>

      <SettingsSection title='Page zoom'>
        <View style={styles.settingRow}>
          <SettingCopy
            title='Enforce manual page zoom'
            description='Allow pinch zoom even when a website normally prevents it.'
          />
          <Switch
            accessibilityLabel='Enforce manual page zoom'
            value={enforceManualPageZoom}
            onValueChange={onEnforceManualPageZoomChange}
            trackColor={{ false: '#bac3d2', true: '#7eb2ee' }}
            thumbColor={enforceManualPageZoom ? '#1f6fd1' : '#ffffff'}
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
