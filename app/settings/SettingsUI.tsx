import { createContext, useContext } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'

const SettingsDarkModeContext = createContext(false)

export const SettingsThemeProvider = SettingsDarkModeContext.Provider

export function useSettingsDarkMode () {
  return useContext(SettingsDarkModeContext)
}

export function ChoiceGroup<T extends string> ({
  options,
  selected,
  onSelect
}: {
  options: ReadonlyArray<{ id: T; title: string }>
  selected: T
  onSelect: (value: T) => void
}) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={styles.choiceGroup}>
      {options.map((option) => {
        const isSelected = option.id === selected

        return (
          <Pressable
            key={option.id}
            accessibilityRole='radio'
            accessibilityState={{ selected: isSelected }}
            style={[
              styles.choice,
              isSelected ? styles.choiceSelected : null,
              isSelected && isDark ? darkStyles.choiceSelected : null
            ]}
            onPress={() => onSelect(option.id)}
          >
            <Text style={[
              styles.choiceText,
              isDark ? darkStyles.primaryText : null,
              isSelected ? styles.choiceTextSelected : null,
              isSelected && isDark ? darkStyles.choiceTextSelected : null
            ]}>
              {option.title}
            </Text>
            <View style={[
              styles.radio,
              isSelected ? styles.radioSelected : null,
              isSelected && isDark ? darkStyles.radioSelected : null
            ]}>
              {isSelected && (
                <View style={[styles.radioDot, isDark ? darkStyles.radioDot : null]} />
              )}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export function SettingsSection ({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={[styles.section, isDark ? darkStyles.surface : null]}>
      <Text style={[styles.sectionTitle, isDark ? darkStyles.sectionTitle : null]}>{title}</Text>
      <View style={[styles.sectionCard, isDark ? darkStyles.sectionCard : null]}>{children}</View>
    </View>
  )
}

export function SettingCopy ({
  title,
  description,
  prominent = false
}: {
  title: string
  description: string
  prominent?: boolean
}) {
  const isDark = useSettingsDarkMode()

  return (
    <View style={styles.settingCopy}>
      <Text style={[
        styles.settingTitle,
        prominent ? styles.settingTitleProminent : null,
        isDark ? darkStyles.primaryText : null
      ]}>
        {title}
      </Text>
      <Text style={[
        styles.settingDescription,
        prominent ? styles.settingDescriptionProminent : null,
        isDark ? darkStyles.secondaryText : null
      ]}>
        {description}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#ffffff'
  },
  sectionTitle: {
    backgroundColor: '#f5f8fc',
    color: '#687086',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingBottom: 8,
    paddingHorizontal: 20,
    paddingTop: 18,
    textTransform: 'uppercase'
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderBottomColor: '#e1e7f0',
    borderBottomWidth: 1,
    borderTopColor: '#e1e7f0',
    borderTopWidth: 1,
    overflow: 'hidden'
  },
  settingCopy: {
    flex: 1,
    gap: 4
  },
  settingTitle: {
    color: '#1f2a44',
    fontSize: 14,
    fontWeight: '700'
  },
  settingTitleProminent: {
    fontSize: 15
  },
  settingDescription: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17
  },
  settingDescriptionProminent: {
    fontSize: 13,
    lineHeight: 18
  },
  choiceGroup: {
    padding: 6
  },
  choice: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 12
  },
  choiceSelected: {
    backgroundColor: '#edf5ff'
  },
  choiceText: {
    color: '#384158',
    fontSize: 14,
    fontWeight: '600'
  },
  choiceTextSelected: {
    color: '#1f6fd1'
  },
  radio: {
    alignItems: 'center',
    borderColor: '#9aa7ba',
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20
  },
  radioSelected: {
    borderColor: '#1f6fd1'
  },
  radioDot: {
    backgroundColor: '#1f6fd1',
    borderRadius: 5,
    height: 10,
    width: 10
  }
})

const darkStyles = StyleSheet.create({
  surface: {
    backgroundColor: BROWSER_PALETTES.dark.surface
  },
  primaryText: {
    color: BROWSER_PALETTES.dark.text
  },
  secondaryText: {
    color: BROWSER_PALETTES.dark.mutedText
  },
  sectionTitle: {
    backgroundColor: BROWSER_PALETTES.dark.shell,
    color: '#98a4b8'
  },
  sectionCard: {
    backgroundColor: BROWSER_PALETTES.dark.surface,
    borderBottomColor: BROWSER_PALETTES.dark.border,
    borderTopColor: BROWSER_PALETTES.dark.border
  },
  choiceSelected: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  choiceTextSelected: {
    color: BROWSER_PALETTES.dark.text
  },
  radioSelected: {
    borderColor: BROWSER_PALETTES.dark.selectedControl
  },
  radioDot: {
    backgroundColor: BROWSER_PALETTES.dark.selectedControl
  }
})
