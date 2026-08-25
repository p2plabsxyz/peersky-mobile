const {
  withAndroidManifest,
  withInfoPlist,
  withMainApplication
} = require('@expo/config-plugins')

const ANDROID_PERMISSIONS = [
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_WIFI_MULTICAST_STATE'
]
const BONJOUR_SERVICE = '_hyperdht-mdns._udp'
const MULTICAST_FIELD = '  private var lanMulticastLock: WifiManager.MulticastLock? = null'
const MULTICAST_SETUP = [
  '    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager',
  '    lanMulticastLock = wifiManager.createMulticastLock("peersky-hyperdht-mdns").apply {',
  '      setReferenceCounted(false)',
  '      acquire()',
  '    }'
].join('\n')

module.exports = function withLANDiscovery (config) {
  config = withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest
    const permissions = manifest['uses-permission'] || []

    for (const permission of ANDROID_PERMISSIONS) {
      const exists = permissions.some((entry) => entry.$?.['android:name'] === permission)
      if (!exists) permissions.push({ $: { 'android:name': permission } })
    }

    manifest['uses-permission'] = permissions
    return androidConfig
  })

  config = withMainApplication(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'kt') {
      throw new Error('LAN discovery requires a Kotlin MainApplication.')
    }

    androidConfig.modResults.contents = addMulticastLock(androidConfig.modResults.contents)
    return androidConfig
  })

  return withInfoPlist(config, (iosConfig) => {
    const services = iosConfig.modResults.NSBonjourServices || []
    if (!services.includes(BONJOUR_SERVICE)) services.push(BONJOUR_SERVICE)
    iosConfig.modResults.NSBonjourServices = services
    iosConfig.modResults.NSLocalNetworkUsageDescription =
      'PeerSky uses your local network to discover and connect to nearby PeerSky devices.'
    return iosConfig
  })
}

function addMulticastLock (contents) {
  let result = contents

  if (!result.includes('import android.content.Context')) {
    result = result.replace(
      'import android.app.Application',
      'import android.app.Application\nimport android.content.Context\nimport android.net.wifi.WifiManager'
    )
  }

  if (!result.includes(MULTICAST_FIELD)) {
    result = result.replace(
      'class MainApplication : Application(), ReactApplication {',
      `class MainApplication : Application(), ReactApplication {\n\n${MULTICAST_FIELD}`
    )
  }

  if (!result.includes('createMulticastLock("peersky-hyperdht-mdns")')) {
    result = result.replace(
      '    super.onCreate()',
      `    super.onCreate()\n${MULTICAST_SETUP}`
    )
  }

  return result
}

module.exports.addMulticastLock = addMulticastLock
