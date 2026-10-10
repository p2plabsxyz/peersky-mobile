const { IOSConfig, withAndroidManifest, withInfoPlist } = require('@expo/config-plugins')

// hyper:// links open PeerSky: a QR code scanned with the camera, a link tapped
// in Notes, Messages or an email. The app reads them like any link it is
// opened with (app/incoming-links.ts). peersky:// comes from `scheme` in
// app.json; a second scheme there makes expo-linking warn on every start that
// it found several, so this one goes into the native files directly.
const HYPER_SCHEME = 'hyper'
// Apple requires a browser to name http and https in its Info.plist before it
// can be granted the default browser entitlement. iOS sends web links to an
// app this way only once it is the default browser; until then they go to
// Safari as before. Android has its own filters for them in app.json.
const WEB_SCHEMES = ['http', 'https']

function addHyperSchemeToInfoPlist (infoPlist) {
  return IOSConfig.Scheme.appendScheme(HYPER_SCHEME, infoPlist)
}

function addWebSchemesToInfoPlist (infoPlist) {
  return WEB_SCHEMES.reduce((result, scheme) => IOSConfig.Scheme.appendScheme(scheme, result), infoPlist)
}

function isHyperLinkFilter (filter) {
  return (filter.data || []).some((data) => data?.$?.['android:scheme'] === HYPER_SCHEME)
}

function addHyperIntentFilter (manifest) {
  const activity = (manifest.manifest.application?.[0]?.activity || [])
    .find((item) => item.$?.['android:name'] === '.MainActivity')
  if (!activity) throw new Error('Unable to find MainActivity to open hyper:// links.')

  activity['intent-filter'] = activity['intent-filter'] || []
  if (activity['intent-filter'].some(isHyperLinkFilter)) return manifest

  activity['intent-filter'].push({
    action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
    category: [
      { $: { 'android:name': 'android.intent.category.DEFAULT' } },
      { $: { 'android:name': 'android.intent.category.BROWSABLE' } }
    ],
    data: [{ $: { 'android:scheme': HYPER_SCHEME } }]
  })
  return manifest
}

module.exports = function withHyperLinks (config) {
  config = withInfoPlist(config, (iosConfig) => {
    iosConfig.modResults = addWebSchemesToInfoPlist(addHyperSchemeToInfoPlist(iosConfig.modResults))
    return iosConfig
  })
  return withAndroidManifest(config, (androidConfig) => {
    androidConfig.modResults = addHyperIntentFilter(androidConfig.modResults)
    return androidConfig
  })
}

module.exports.HYPER_SCHEME = HYPER_SCHEME
module.exports.addHyperIntentFilter = addHyperIntentFilter
module.exports.addHyperSchemeToInfoPlist = addHyperSchemeToInfoPlist
module.exports.addWebSchemesToInfoPlist = addWebSchemesToInfoPlist
