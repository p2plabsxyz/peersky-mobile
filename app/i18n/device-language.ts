import { I18nManager, Platform, Settings } from 'react-native'

// The languages the phone asks apps for, best first. On iOS they sit in the
// app's defaults, where a language picked for PeerSky alone in iOS Settings
// lands as well. Android gives the locale the app runs in, which follows one
// picked for PeerSky in Android Settings.
export function deviceLanguageTags (): string[] {
  const tags: string[] = []
  try {
    if (Platform.OS === 'ios') {
      const preferred: unknown = Settings.get('AppleLanguages')
      if (Array.isArray(preferred)) {
        for (const tag of preferred) if (typeof tag === 'string') tags.push(tag)
      }
    } else {
      const locale = (I18nManager.getConstants() as { localeIdentifier?: string }).localeIdentifier
      if (typeof locale === 'string') tags.push(locale)
    }
  } catch {}
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale)
  } catch {}
  return tags
}
