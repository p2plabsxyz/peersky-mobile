const fs = require('fs')
const path = require('path')
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')

// The languages PeerSky comes in, for Android's own list. Since Android 13 a
// person can pick a language for one app in Android Settings, and the list
// there is this file. iOS finds its list from the <code>.lproj folders the
// locales in app.json make. Both come from app/i18n/native/languages.json,
// which scripts/i18n.mjs writes from LANGUAGES in app/i18n/languages.mjs.
const LANGUAGES_FILE = path.join(__dirname, '..', 'app', 'i18n', 'native', 'languages.json')

module.exports = function withAppLanguages (config) {
  const codes = JSON.parse(fs.readFileSync(LANGUAGES_FILE, 'utf8'))

  config = withDangerousMod(config, ['android', (androidConfig) => {
    const dir = path.join(androidConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
    fs.mkdirSync(dir, { recursive: true })
    const locales = codes.map((code) => `  <locale android:name="${code}"/>`).join('\n')
    fs.writeFileSync(
      path.join(dir, 'locales_config.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n${locales}\n</locale-config>\n`
    )
    return androidConfig
  }])

  return withAndroidManifest(config, (androidConfig) => {
    const application = androidConfig.modResults.manifest.application?.[0]
    if (application?.$) application.$['android:localeConfig'] = '@xml/locales_config'
    return androidConfig
  })
}
