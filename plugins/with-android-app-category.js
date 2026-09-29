const { withAndroidManifest } = require('@expo/config-plugins')

// Android groups apps by this when the launcher or the system settings offer
// categories. Without it PeerSky is uncategorised, the same gap that had iOS
// filing it under the developer's name rather than with the other browsers.
module.exports = function withAndroidAppCategory (config) {
  return withAndroidManifest(config, (androidConfig) => {
    const application = androidConfig.modResults.manifest.application?.[0]
    if (application?.$) application.$['android:appCategory'] = 'productivity'
    return androidConfig
  })
}
