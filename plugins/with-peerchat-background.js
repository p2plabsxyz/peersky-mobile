const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication
} = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const ANDROID_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
  // So the service comes back after a reboot or an app update instead of
  // leaving the peer offline until PeerSky is opened by hand.
  'android.permission.RECEIVE_BOOT_COMPLETED'
]
const PACKAGE_REGISTRATION = 'add(PeerChatBackgroundPackage())'
const SERVICE_NAME = '.PeerChatBackgroundService'
const BOOT_RECEIVER_NAME = '.PeerChatBootReceiver'
const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')

module.exports = function withPeerChatBackground (config) {
  config = withAndroidManifest(config, (androidConfig) => {
    androidConfig.modResults.manifest = addPeerChatBackgroundManifest(
      androidConfig.modResults.manifest
    )
    return androidConfig
  })

  config = withMainApplication(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'kt') {
      throw new Error('PeerChat background support requires a Kotlin MainApplication.')
    }
    androidConfig.modResults.contents = addPeerChatBackgroundPackage(
      androidConfig.modResults.contents
    )
    return androidConfig
  })

  return withDangerousMod(config, ['android', async (androidConfig) => {
    const packageName = androidConfig.android?.package
    if (!packageName) throw new Error('Android package name is required for PeerChat background support.')
    const sourceDirectory = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app/src/main/java',
      ...packageName.split('.')
    )
    fs.mkdirSync(sourceDirectory, { recursive: true })
    for (const filename of [
      'PeerChatBackgroundModule.kt',
      'PeerChatBackgroundPackage.kt',
      'PeerChatBackgroundService.kt',
      'PeerChatBootReceiver.kt'
    ]) {
      const source = fs.readFileSync(path.join(TEMPLATE_DIRECTORY, `${filename}.template`), 'utf8')
        .replaceAll('__PACKAGE_NAME__', packageName)
      fs.writeFileSync(path.join(sourceDirectory, filename), source)
    }

    const rawDirectory = path.join(androidConfig.modRequest.platformProjectRoot, 'app/src/main/res/raw')
    fs.mkdirSync(rawDirectory, { recursive: true })
    for (const [sourceName, targetName] of [
      ['send.mp3', 'peerchat_send.mp3'],
      ['receive.mp3', 'peerchat_receive.mp3'],
      ['pop.mp3', 'peerchat_pop.mp3']
    ]) {
      fs.copyFileSync(
        path.join(__dirname, '..', 'assets/sounds/peerchat', sourceName),
        path.join(rawDirectory, targetName)
      )
    }
    return androidConfig
  }])
}

function addPeerChatBackgroundManifest (manifest) {
  const permissions = manifest['uses-permission'] || []
  for (const permission of ANDROID_PERMISSIONS) {
    if (!permissions.some((entry) => entry.$?.['android:name'] === permission)) {
      permissions.push({ $: { 'android:name': permission } })
    }
  }
  manifest['uses-permission'] = permissions

  const application = manifest.application?.[0]
  if (!application) throw new Error('Android application manifest entry is missing.')
  const services = application.service || []
  if (!services.some((entry) => entry.$?.['android:name'] === SERVICE_NAME)) {
    services.push({
      $: {
        'android:name': SERVICE_NAME,
        'android:exported': 'false',
        'android:foregroundServiceType': 'remoteMessaging'
      }
    })
  }
  application.service = services

  // Rewritten rather than only added when missing: prebuild merges into an
  // existing android/ directory, so an entry from an earlier run would keep its
  // old attributes forever.
  const bootReceiver = {
    $: {
      'android:name': BOOT_RECEIVER_NAME,
      'android:enabled': 'true',
      // Exported, because the system sends these from its own uid and a
      // non-exported receiver is skipped. Both actions are protected
      // broadcasts, so no other app can forge them.
      'android:exported': 'true'
    },
    'intent-filter': [{
      action: [
        { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
        { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } }
      ]
    }]
  }
  const receivers = (application.receiver || [])
    .filter((entry) => entry.$?.['android:name'] !== BOOT_RECEIVER_NAME)
  receivers.push(bootReceiver)
  application.receiver = receivers
  return manifest
}

function addPeerChatBackgroundPackage (contents) {
  const marker = 'PackageList(this).packages.apply {'
  if (!contents.includes(marker)) throw new Error('Unable to register the PeerChat background package.')
  if (contents.includes(PACKAGE_REGISTRATION)) return contents
  return contents.replace(marker, `${marker}\n          ${PACKAGE_REGISTRATION}`)
}

module.exports.addPeerChatBackgroundManifest = addPeerChatBackgroundManifest
module.exports.addPeerChatBackgroundPackage = addPeerChatBackgroundPackage
