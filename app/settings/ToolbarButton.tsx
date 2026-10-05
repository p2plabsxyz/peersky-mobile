import { Pressable, StyleSheet, Text, View } from 'react-native'

import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { TOOLBAR_BUTTON_ICONS } from '../toolbar-button-icons'
import { TOOLBAR_BUTTONS } from '../toolbar-button.mjs'
import type { ToolbarButton } from './useBrowserPreferences'
import { SettingsSection, useSettingsDarkMode } from './SettingsUI'
import BackIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import ForwardIcon from '../../assets/icons/bootstrap/arrow-right.svg'

const ICON_SIZE = 22
const PREVIEW_ICON_SIZE = 20

/**
 * The button in the middle of the bar at the bottom: the bar drawn small with
 * that place picked out, and every button that can go there.
 */
export function ToolbarButtonSettings ({
  selected,
  onSelect
}: {
  selected: ToolbarButton
  onSelect: (button: ToolbarButton) => void
}) {
  const isDark = useSettingsDarkMode()
  const colors = isDark ? DARK : LIGHT
  const SelectedIcon = TOOLBAR_BUTTON_ICONS[selected] || TOOLBAR_BUTTON_ICONS.burn

  return (
    <View style={[styles.page, { backgroundColor: colors.page }]}>
      <SettingsSection title='Toolbar button'>
        <View style={styles.previewWrap}>
          <View
            accessible
            accessibilityLabel={`The bottom bar, with ${TOOLBAR_BUTTONS.find((button) => button.id === selected)?.title || 'Burn Tabs and Data'} in the middle`}
            style={[styles.preview, { borderColor: colors.outline }]}
          >
            <BackIcon width={PREVIEW_ICON_SIZE} height={PREVIEW_ICON_SIZE} color={colors.muted} />
            <ForwardIcon width={PREVIEW_ICON_SIZE} height={PREVIEW_ICON_SIZE} color={colors.muted} />
            <View style={[styles.previewMiddle, { backgroundColor: colors.highlight, borderColor: colors.accent }]}>
              <SelectedIcon width={PREVIEW_ICON_SIZE} height={PREVIEW_ICON_SIZE} color={colors.accent} />
            </View>
            <View style={[styles.previewTabs, { borderColor: colors.muted }]}>
              <Text style={[styles.previewTabsText, { color: colors.muted }]}>1</Text>
            </View>
            <View style={styles.previewDots}>
              {[0, 1, 2].map((dot) => (
                <View key={dot} style={[styles.previewDot, { backgroundColor: colors.muted }]} />
              ))}
            </View>
          </View>
        </View>
        {TOOLBAR_BUTTONS.map((button, index) => {
          const Icon = TOOLBAR_BUTTON_ICONS[button.id as ToolbarButton]
          const isSelected = button.id === selected
          return (
            <View key={button.id}>
              {index > 0 && <View style={[styles.divider, { backgroundColor: colors.divider }]} />}
              <Pressable
                accessibilityRole='radio'
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.pressed } : null]}
                onPress={() => onSelect(button.id as ToolbarButton)}
              >
                <Icon width={ICON_SIZE} height={ICON_SIZE} color={colors.text} />
                <Text style={[styles.rowText, { color: colors.text }]}>{button.title}</Text>
                {isSelected && <CheckIcon width={20} height={20} color={colors.accent} />}
              </Pressable>
            </View>
          )
        })}
      </SettingsSection>
      <Text style={[styles.note, { color: colors.muted }]}>
        With another button here, Burn Tabs and Data moves to the menu.
      </Text>
    </View>
  )
}

const LIGHT = {
  accent: '#1f6fd1',
  divider: '#e6ecf5',
  highlight: '#e8f1fc',
  muted: '#687086',
  outline: '#d3dbe8',
  page: '#f5f8fc',
  pressed: '#f0f4fa',
  text: '#1f2a44'
}

const DARK = {
  accent: '#7eb2ee',
  divider: BROWSER_PALETTES.dark.border,
  highlight: '#1d3352',
  muted: '#aab4c8',
  outline: '#3f3f46',
  page: BROWSER_PALETTES.dark.shell,
  pressed: '#2f2f35',
  text: '#f1f2f7'
}

const styles = StyleSheet.create({
  page: { flexGrow: 1 },
  previewWrap: { paddingHorizontal: 16, paddingVertical: 18 },
  preview: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1.5,
    flexDirection: 'row',
    height: 52,
    justifyContent: 'space-around',
    paddingHorizontal: 8
  },
  previewMiddle: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    width: 48
  },
  previewTabs: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    width: 20
  },
  previewTabsText: { fontSize: 11, fontWeight: '700' },
  previewDots: { gap: 3 },
  previewDot: { borderRadius: 2, height: 4, width: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 50,
    paddingHorizontal: 16
  },
  rowText: { flex: 1, fontSize: 16 },
  note: { fontSize: 12, lineHeight: 17, paddingHorizontal: 20, paddingTop: 10 }
})
