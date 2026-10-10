import { Pressable, StyleSheet, Text, View } from 'react-native'

import { ADDRESS_BAR_BUTTON_ICONS } from '../address-bar-button-icons'
import { ADDRESS_BAR_BUTTONS, addressBarButtonTitle } from '../address-bar-button.mjs'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import type { AddressBarButton } from './useBrowserPreferences'
import { SettingsSection, useSettingsDarkMode } from './SettingsUI'
import ReloadIcon from '../../assets/icons/bootstrap/arrow-clockwise.svg'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import ShieldCheckIcon from '../../assets/icons/bootstrap/shield-check.svg'

const ICON_SIZE = 22
const PREVIEW_ICON_SIZE = 18

/**
 * The button at the end of the address bar, after reload: the bar drawn small
 * with that place picked out, and every button that can go there.
 */
export function AddressBarButtonSettings ({
  selected,
  onSelect
}: {
  selected: AddressBarButton
  onSelect: (button: AddressBarButton) => void
}) {
  const isDark = useSettingsDarkMode()
  const colors = isDark ? DARK : LIGHT
  const SelectedIcon = ADDRESS_BAR_BUTTON_ICONS[selected] || ADDRESS_BAR_BUTTON_ICONS.share

  return (
    <View style={[styles.page, { backgroundColor: colors.page }]}>
      <SettingsSection title='Address bar button'>
        <View style={styles.previewWrap}>
          <View
            accessible
            accessibilityLabel={selected === 'none'
              ? 'The address bar, with reload only'
              : `The address bar, with ${addressBarButtonTitle(selected)} after reload`}
            style={[styles.preview, { borderColor: colors.outline }]}
          >
            <ShieldCheckIcon width={PREVIEW_ICON_SIZE} height={PREVIEW_ICON_SIZE} color={colors.muted} />
            <Text numberOfLines={1} style={[styles.previewAddress, { color: colors.text }]}>example.com</Text>
            <ReloadIcon width={PREVIEW_ICON_SIZE} height={PREVIEW_ICON_SIZE} color={colors.muted} />
            {selected !== 'none' && (
              <View style={[styles.previewButton, { backgroundColor: colors.highlight, borderColor: colors.accent }]}>
                <SelectedIcon width={PREVIEW_ICON_SIZE} height={PREVIEW_ICON_SIZE} color={colors.accent} />
              </View>
            )}
          </View>
        </View>
        {ADDRESS_BAR_BUTTONS.map((button, index) => {
          const Icon = ADDRESS_BAR_BUTTON_ICONS[button.id as AddressBarButton]
          const isSelected = button.id === selected
          return (
            <View key={button.id}>
              {index > 0 && <View style={[styles.divider, { backgroundColor: colors.divider }]} />}
              <Pressable
                accessibilityRole='radio'
                accessibilityState={{ selected: isSelected }}
                style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.pressed } : null]}
                onPress={() => onSelect(button.id as AddressBarButton)}
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
        It shows on web and hyper:// pages, when the page has something for it to do. Everything here is also in the menu.
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
    borderRadius: 24,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 12,
    height: 48,
    paddingHorizontal: 14
  },
  previewAddress: { flex: 1, fontSize: 15 },
  previewButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    marginRight: -6,
    width: 36
  },
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
