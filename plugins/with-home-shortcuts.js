const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins')

// Quick actions on the app icon: a long press on the home screen. Each opens
// as a peersky://shortcut/ link, which the app follows like any other link it
// is opened with (app/home-shortcuts.mjs). iOS shows at most four.
const SHORTCUTS = [
  { type: 'peersky.shortcut.paste', title: 'Paste and Go', symbol: 'doc.on.clipboard' },
  { type: 'peersky.shortcut.new-tab', title: 'New Tab', symbol: 'plus' },
  { type: 'peersky.shortcut.incognito', title: 'New Incognito Tab', symbol: 'eyeglasses' },
  { type: 'peersky.shortcut.app-icon', title: 'App Icon', symbol: 'paintpalette' }
]

const MARKER = '// PeerSky home screen quick actions'

// The link a quick action stands for. Given to React Native as the launch URL
// when the action opened the app, so the app reads it the moment it starts;
// a link sent later would be lost before anything listened for it.
const HELPERS = `
${MARKER}
private let peerSkyShortcutPrefix = "peersky.shortcut."

private func peerSkyShortcutURL(_ item: UIApplicationShortcutItem?) -> URL? {
  guard let type = item?.type, type.hasPrefix(peerSkyShortcutPrefix) else { return nil }
  return URL(string: "peersky://shortcut/" + type.dropFirst(peerSkyShortcutPrefix.count))
}
`

const HANDLER = `
  ${MARKER}: with the app already running, the link goes straight to it.
  public override func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    guard let url = peerSkyShortcutURL(shortcutItem) else {
      super.application(application, performActionFor: shortcutItem, completionHandler: completionHandler)
      return
    }
    completionHandler(RCTLinkingManager.application(application, open: url, options: [:]))
  }
`

function addShortcutsToAppDelegate (contents) {
  if (contents.includes(MARKER)) return contents

  const platform = '#if os(iOS) || os(tvOS)\n    window = UIWindow'
  const launch = 'launchOptions: launchOptions)'
  const finish = '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)\n  }'
  const linking = '  // Linking API\n'
  for (const needle of [platform, launch, finish, linking]) {
    if (!contents.includes(needle)) throw new Error('Unable to add home screen quick actions to AppDelegate.swift.')
  }

  return contents
    .replace(platform, [
      '    // Opened from a quick action: hand its link over as the launch URL.',
      '    var reactLaunchOptions = launchOptions ?? [:]',
      '    let launchShortcutURL = peerSkyShortcutURL(launchOptions?[.shortcutItem] as? UIApplicationShortcutItem)',
      '    if let launchShortcutURL { reactLaunchOptions[.url] = launchShortcutURL }',
      '',
      platform
    ].join('\n'))
    .replace(launch, 'launchOptions: reactLaunchOptions)')
    .replace(finish, [
      '    let finished = super.application(application, didFinishLaunchingWithOptions: launchOptions)',
      '    guard let launchShortcutURL else { return finished }',
      '    // A development build holds a link it was opened with until a bundle',
      '    // loads, and only hears of it as an opened link. Expo\'s side only, so',
      '    // React Native gets it once, through the launch URL.',
      '    _ = super.application(application, open: launchShortcutURL, options: [:])',
      '    // Answering false stops iOS from sending the same quick action again,',
      '    // which would open it twice.',
      '    return false',
      '  }'
    ].join('\n'))
    .replace(linking, `${HANDLER.replace(/^\n/, '')}\n${linking}`)
    .concat(HELPERS)
}

module.exports = function withHomeShortcuts (config) {
  config = withInfoPlist(config, (iosConfig) => {
    iosConfig.modResults.UIApplicationShortcutItems = SHORTCUTS.map((shortcut) => ({
      UIApplicationShortcutItemType: shortcut.type,
      UIApplicationShortcutItemTitle: shortcut.title,
      UIApplicationShortcutItemIconSymbolName: shortcut.symbol
    }))
    return iosConfig
  })

  return withAppDelegate(config, (iosConfig) => {
    if (iosConfig.modResults.language !== 'swift') {
      throw new Error('Home screen quick actions expect a Swift AppDelegate.')
    }
    iosConfig.modResults.contents = addShortcutsToAppDelegate(iosConfig.modResults.contents)
    return iosConfig
  })
}

module.exports.SHORTCUTS = SHORTCUTS
module.exports.addShortcutsToAppDelegate = addShortcutsToAppDelegate
