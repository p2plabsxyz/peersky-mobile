// What iOS shows for PeerSky in its own prompts, from Info.plist. Each
// language's copy is written to app/i18n/native by scripts/i18n.mjs, and the
// locales in app.json hand those to iOS. The English has to match app.json.
export const INFO_PLIST_TEXT = Object.freeze({
  NSCameraUsageDescription: 'PeerSky uses the camera to scan QR codes when you link a device or open a shared room or drive, to take photos you send in PeerChat or set as a group picture, and when a website you visit requests it and you allow access.',
  NSLocalNetworkUsageDescription: 'PeerSky uses your local network to discover and connect to nearby PeerSky devices.',
  NSLocationWhenInUseUsageDescription: 'PeerSky uses your location only when a website you visit requests it and you allow access.',
  NSMicrophoneUsageDescription: 'PeerSky uses the microphone only when a website you visit requests it and you allow access.',
  NSPhotoLibraryAddUsageDescription: 'PeerSky saves a picture or video to your photo library when you choose Save to Photos.'
})

// The quick actions on the app icon (plugins/with-home-shortcuts.js). iOS
// looks a quick action's title up in InfoPlist.strings by the title itself,
// and Expo writes those files with each key unquoted, which a title with a
// space in it would break. So Info.plist holds these keys as the titles, and
// each language's InfoPlist.strings, English too, has the words.
export const SHORTCUT_TEXT = Object.freeze({
  ShortcutPasteAndGo: 'Paste and Go',
  ShortcutNewTab: 'New Tab',
  ShortcutNewIncognitoTab: 'New Incognito Tab',
  ShortcutAppIcon: 'App Icon'
})

// What the home screen widgets and the PeerTunes buttons show, in Swift
// (targets/widgets). Each language's words go into
// targets/widgets/_shared/Localizable.xcstrings, which Xcode builds into the
// widgets and the app alike.
export const WIDGET_TEXT = Object.freeze([
  'Search',
  'Search or enter address',
  'Bookmarks',
  'Pages you bookmark in PeerSky show up here.',
  'Search, and open the P2P apps and your bookmarks.',
  'What is playing. The medium size has the controls.',
  'Nothing playing',
  'Tap to open PeerTunes',
  'Now playing',
  'Paused',
  'Last played',
  'Play',
  'Pause',
  'Previous song',
  'Next song',
  'Previous Song',
  'Next Song',
  // The lock screen buttons' names and lines in the widget gallery.
  'Private search',
  'Opens an incognito tab, ready to search.',
  'Burn Tabs and Data',
  'Burns your tabs, history and cached data right away.',
  'Opens your bookmarks.',
  'P2P sites',
  'Opens the list of hyper:// sites you have opened',
  'Clear all P2P data',
  "Clears all P2P data and this device's identity right away, without asking."
])

// Names in the widgets' Swift that stay as they are in every language. Listed
// so Xcode finds every key it would pull out of the code already there.
export const WIDGET_NAMES = Object.freeze(['PeerSky', 'PeerTunes'])

// What Android shows for PeerChat's background connection, by string resource
// name: the notification that keeps it running, and its channel in Android's
// notification settings (plugins/templates/PeerChatBackgroundService.kt.template).
// The locales in app.json turn each language's copy into its strings.xml.
export const ANDROID_TEXT = Object.freeze({
  peerchat_background_text: 'Staying connected so messages reach you',
  peerchat_background_channel: 'PeerChat background connection',
  peerchat_background_channel_description: 'Keeps PeerChat connected while PeerSky is in the background'
})
