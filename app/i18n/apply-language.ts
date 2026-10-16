import { I18nManager } from 'react-native'
import { deviceLanguageTags } from './device-language'
import { setLanguage } from './i18n.mjs'
import { isLanguageCode, isRtlLanguage, matchLanguage } from './languages.mjs'

/** The language a setting means: the one it names, or the phone's. */
export function resolveLanguage (setting: string) {
  return isLanguageCode(setting) ? setting : matchLanguage(deviceLanguageTags())
}

/**
 * Puts a language setting in force. The text on every screen changes at once.
 * Which side the screens start from does not: React Native lays them out by
 * the direction PeerSky started with, so a switch into or out of a language
 * read right to left lands at the next start. True while that is still to come.
 */
export function applyLanguageSetting (setting: string): boolean {
  const code = resolveLanguage(setting)
  setLanguage(code)
  const rtl = isRtlLanguage(code)
  if (isLanguageCode(setting)) {
    // Picked in PeerSky: right to left exactly when the language reads so,
    // whatever the phone's own language does.
    I18nManager.allowRTL(rtl)
    I18nManager.forceRTL(rtl)
  } else {
    // The phone's language: its direction, as the phone sets it.
    I18nManager.allowRTL(true)
    I18nManager.forceRTL(false)
  }
  return I18nManager.isRTL !== rtl
}
