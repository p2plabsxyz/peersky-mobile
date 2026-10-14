import { File, Paths } from 'expo-file-system'
import { CATALOG_LOADERS } from './catalogs'
import { deviceLanguageTags } from './device-language'
import { registerCatalogs, setLanguage } from './i18n.mjs'
import { isLanguageCode, matchLanguage } from './languages.mjs'

// Before the first screen draws: the catalogs, and the language in force. The
// language picked in PeerSky is read from the preferences here, at once, so it
// shows from the first frame rather than once the preferences have loaded.
registerCatalogs(CATALOG_LOADERS)
setLanguage(startupLanguage())

function startupLanguage () {
  try {
    const file = new File(Paths.document, 'browser-preferences.json')
    if (file.exists) {
      const picked: unknown = JSON.parse(file.textSync())?.language
      if (isLanguageCode(picked)) return picked
    }
  } catch {}
  return matchLanguage(deviceLanguageTags())
}
