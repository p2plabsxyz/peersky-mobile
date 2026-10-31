import { StyleSheet, Text } from 'react-native'
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
// it, with its name in the language shown now beneath. The last part of
// General: a page of its own in Settings was one more place to look.
export function LanguageSection ({ language, onLanguageChange }: LanguageProps) {
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
    <>
      <SettingsSection title={t('Language')}>
        <ChoiceGroup options={options} selected={language} onSelect={onLanguageChange} />
      </SettingsSection>
      <Text style={[styles.note, isDark ? styles.noteDark : null]}>
        {t('Websites show in their own language.')}
      </Text>
    </>
  )
}

const styles = StyleSheet.create({
  note: {
    color: '#687086',
    fontSize: 12,
    lineHeight: 17,
    paddingBottom: 24,
    paddingHorizontal: 20,
    paddingTop: 12
  },
  noteDark: {
    color: BROWSER_PALETTES.dark.mutedText
  }
})
