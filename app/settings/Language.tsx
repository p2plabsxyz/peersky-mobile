import { StyleSheet, Text, View } from 'react-native'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { deviceLanguageTags } from '../i18n/device-language'
import { t } from '../i18n/i18n.mjs'
import { languageName } from '../i18n/language-name.mjs'
import { LANGUAGES, SYSTEM_LANGUAGE, languageNamed, matchLanguage } from '../i18n/languages.mjs'
import { ChoiceGroup, SettingsSection, useSettingsDarkMode } from './SettingsUI'

type LanguageProps = {
  language: string
  onLanguageChange: (language: string) => void
}

// Each language under its own name, which is how somebody who reads it finds
// it, with its name in the language shown now beneath.
export function LanguageSettings ({ language, onLanguageChange }: LanguageProps) {
  const isDark = useSettingsDarkMode()
  const phone = languageNamed(matchLanguage(deviceLanguageTags()))
  const options = [
    { id: SYSTEM_LANGUAGE, title: t('Phone language'), description: phone?.native || 'English' },
    ...LANGUAGES.map((entry) => {
      const name = languageName(entry)
      return { id: entry.code, title: entry.native, description: name === entry.native ? undefined : name }
    })
  ]

  return (
    <View style={[styles.page, isDark ? styles.pageDark : null]}>
      <SettingsSection title={t('Language')}>
        <ChoiceGroup options={options} selected={language} onSelect={onLanguageChange} />
      </SettingsSection>
      <Text style={[styles.note, isDark ? styles.noteDark : null]}>
        {t('Websites show in their own language.')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#f5f8fc',
    flexGrow: 1,
    paddingBottom: 24
  },
  pageDark: {
    backgroundColor: BROWSER_PALETTES.dark.shell
  },
  note: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 20,
    paddingTop: 12
  },
  noteDark: {
    color: BROWSER_PALETTES.dark.mutedText
  }
})
