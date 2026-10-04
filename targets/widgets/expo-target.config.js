// The home screen widgets: PeerSky (search, the P2P apps, bookmarks) and
// PeerTunes (what is playing). @bacons/apple-targets adds this folder to the
// Xcode project as its own target at prebuild. Files in _shared are built
// into the app too: the PeerTunes buttons run there, where the music plays.
//
// Images come from Assets.xcassets in this folder, made by hand from
// assets/images, rather than the plugin's images option, which writes its
// own copies here on every prebuild.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'PeerSkyWidgets',
  displayName: 'PeerSky',
  bundleIdentifier: '.widgets',
  // Buttons that run an App Intent need iOS 17.
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups']
  }
})
