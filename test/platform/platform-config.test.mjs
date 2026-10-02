import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { addMulticastLock } = require('../../plugins/with-lan-discovery.js')

const ANDROID_LOOPBACK_CLEARTEXT_PLUGIN = './plugins/with-android-loopback-cleartext'
const LAN_DISCOVERY_PLUGIN = './plugins/with-lan-discovery'
const PEERCHAT_BACKGROUND_PLUGIN = './plugins/with-peerchat-background'
const EXPO_NOTIFICATIONS_PLUGIN = 'expo-notifications'
const EXPO_AUDIO_PLUGIN = 'expo-audio'
const REPO_ROOT = new URL('../../', import.meta.url)
const ANDROID_LOOPBACK_CLEARTEXT_PLUGIN_FILE = repoFile('plugins/with-android-loopback-cleartext.js')
const LAN_DISCOVERY_PLUGIN_FILE = repoFile('plugins/with-lan-discovery.js')

describe('mobile platform runtime configuration', () => {
  it('allows browser rotation according to the device orientation setting', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))

    assert.equal(appJson.expo?.orientation, 'default')
  })

  it('keeps Android cleartext scoped to loopback only', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    const plugins = appJson.expo?.plugins || []
    const plugin = await readFile(ANDROID_LOOPBACK_CLEARTEXT_PLUGIN_FILE, 'utf8')

    assert.equal(hasExpoPlugin(plugins, ANDROID_LOOPBACK_CLEARTEXT_PLUGIN), true)
    assert.match(plugin, /android:networkSecurityConfig'] = '@xml\/network_security_config'/)
    assert.match(plugin, /delete applicationAttributes\['android:usesCleartextTraffic'\]/)
    assert.match(plugin, /<base-config cleartextTrafficPermitted="false" \/>/)
    assert.match(plugin, /<domain-config cleartextTrafficPermitted="true">/)
    assert.match(plugin, /<domain includeSubdomains="false">localhost<\/domain>/)
    assert.match(plugin, /<domain includeSubdomains="false">127\.0\.0\.1<\/domain>/)
    assert.doesNotMatch(plugin, /0\.0\.0\.0/)
    assert.doesNotMatch(plugin, /192\.168\./)
  })

  // Restoring a backup onto another phone gave it this phone's keys, and it
  // then wrote to the same feeds. iCloud also got every cached P2P store.
  it('keeps keys, chats and P2P stores out of OS backups', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    assert.equal(hasExpoPlugin(appJson.expo?.plugins || [], './plugins/with-no-device-backup'), true)

    const plugin = await readFile(repoFile('plugins/with-no-device-backup.js'), 'utf8')
    assert.match(plugin, /attributes\['android:allowBackup'\] = 'false'/)
    assert.match(plugin, /attributes\['android:dataExtractionRules'\] = '@xml\/data_extraction_rules'/)
    for (const section of ['cloud-backup', 'device-transfer']) {
      const rules = plugin.slice(plugin.indexOf(`<${section}>`), plugin.indexOf(`</${section}>`))
      for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
        assert.match(rules, new RegExp(`<exclude domain="${domain}" path="\\." />`), `${section} ${domain}`)
      }
    }

    const ios = await readFile(repoFile('plugins/templates/PeerSkyBackupExclusion.m.template'), 'utf8')
    assert.match(ios, /NSDocumentDirectory/)
    assert.match(ios, /setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey/)
    assert.match(ios, /UIApplicationDidFinishLaunchingNotification/)
  })

  // Apple refuses a build that uses a required-reason API without saying why.
  // Bare stats files and reads the clock, React Native keeps user defaults,
  // and a backup checks free space before it writes.
  it('declares why it uses each required-reason API, and that it collects nothing', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    const manifest = appJson.expo?.ios?.privacyManifests
    const reasons = Object.fromEntries(manifest.NSPrivacyAccessedAPITypes.map((entry) => [
      entry.NSPrivacyAccessedAPIType.replace('NSPrivacyAccessedAPICategory', ''),
      entry.NSPrivacyAccessedAPITypeReasons
    ]))
    assert.deepEqual(reasons, {
      FileTimestamp: ['C617.1', '0A2A.1', '3B52.1'],
      UserDefaults: ['CA92.1'],
      DiskSpace: ['E174.1', '85F4.1'],
      SystemBootTime: ['35F9.1']
    })
    assert.deepEqual(manifest.NSPrivacyCollectedDataTypes, [])
    assert.equal(manifest.NSPrivacyTracking, false)
  })

  it('keeps iOS local networking scoped to localhost support, not arbitrary HTTP', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    const ats = appJson.expo?.ios?.infoPlist?.NSAppTransportSecurity

    assert.equal(ats?.NSAllowsLocalNetworking, true)
    assert.notEqual(ats?.NSAllowsArbitraryLoads, true)
  })

  it('declares browser permissions and Android web-link handling', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    const android = appJson.expo?.android
    const infoPlist = appJson.expo?.ios?.infoPlist

    assert.deepEqual(android?.permissions, [
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CAMERA',
      'android.permission.CHANGE_WIFI_MULTICAST_STATE',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
      'android.permission.RECORD_AUDIO'
    ])
    // Template and library permissions nothing in the app uses. Each one is a
    // question a store review asks.
    assert.deepEqual(android?.blockedPermissions, [
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.REQUEST_INSTALL_PACKAGES',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.WRITE_EXTERNAL_STORAGE'
    ])
    assert.equal(android?.intentFilters?.length, 1)
    assert.deepEqual(android.intentFilters[0]?.category, ['BROWSABLE', 'DEFAULT'])
    assert.deepEqual(
      android.intentFilters[0]?.data?.map((entry) => entry.scheme),
      ['http', 'https']
    )
    assert.match(infoPlist?.NSCameraUsageDescription, /website you visit/i)
    assert.match(infoPlist?.NSLocationWhenInUseUsageDescription, /website you visit/i)
    assert.match(infoPlist?.NSMicrophoneUsageDescription, /website you visit/i)
    assert.equal(infoPlist?.ITSAppUsesNonExemptEncryption, true)
  })

  it('includes store build profiles and user-facing policy links', async () => {
    const easJson = JSON.parse(await readFile(repoFile('eas.json'), 'utf8'))
    const settings = await readFile(repoFile('app/settings/SettingsScreen.tsx'), 'utf8')
    const privacySettings = await readFile(repoFile('app/settings/Privacy.tsx'), 'utf8')
    const privacyPolicy = await readFile(repoFile('PRIVACY.md'), 'utf8')
    const contentReport = await readFile(repoFile('.github/ISSUE_TEMPLATE/content-report.yml'), 'utf8')

    assert.equal(easJson.cli?.appVersionSource, 'remote')
    assert.equal(easJson.build?.production?.autoIncrement, true)
    assert.deepEqual(easJson.submit?.production, {})
    assert.match(privacySettings, /blob\/main\/PRIVACY[.]md/)
    // One address in the app, for feedback, a bug, or content that needs
    // taking down. The issue template is still the public route, linked from
    // the privacy policy, and it does not need a GitHub account to write in.
    assert.match(settings, /mailto:\$\{FEEDBACK_EMAIL\}/)
    assert.match(settings, /Send feedback/)
    assert.doesNotMatch(settings, /Report harmful content/)
    assert.match(privacyPolicy, /contact@p2plabs[.]xyz/)
    assert.match(privacyPolicy, /issues\/new[?]template=content-report[.]yml/)
    assert.match(contentReport, /name: Report harmful content/)
  })

  it('configures native local notifications for PeerChat', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    const plugins = appJson.expo?.plugins || []
    const notificationPlugin = plugins.find((plugin) => (
      Array.isArray(plugin) && plugin[0] === EXPO_NOTIFICATIONS_PLUGIN
    ))

    assert.deepEqual(notificationPlugin, [
      EXPO_NOTIFICATIONS_PLUGIN,
      {
        color: '#1f6fd1',
        defaultChannel: 'peerchat-messages-v2',
        icon: './assets/images/notification-icon.png'
      }
    ])
    assert.equal(hasExpoPlugin(plugins, EXPO_AUDIO_PLUGIN), true)
    // PeerTunes plays through its WebView. iOS keeps it going with the audio
    // background mode; Android never starts expo-audio's media service, so it
    // does not declare one Google Play would ask about.
    const audioPlugin = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === EXPO_AUDIO_PLUGIN)
    assert.equal(audioPlugin?.[1]?.enableBackgroundPlayback, false)
    assert.deepEqual(appJson.expo?.ios?.infoPlist?.UIBackgroundModes, ['audio'])
    assert.equal(hasExpoPlugin(plugins, PEERCHAT_BACKGROUND_PLUGIN), true)
    assert.equal(appJson.expo?.android?.softwareKeyboardLayoutMode, 'resize')
    const backgroundPlugin = await readFile(repoFile('plugins/with-peerchat-background.js'), 'utf8')
    const backgroundService = await readFile(
      repoFile('plugins/templates/PeerChatBackgroundService.kt.template'),
      'utf8'
    )
    const backgroundModule = await readFile(
      repoFile('plugins/templates/PeerChatBackgroundModule.kt.template'),
      'utf8'
    )
    assert.match(backgroundPlugin, /FOREGROUND_SERVICE_REMOTE_MESSAGING/)
    assert.match(backgroundPlugin, /foregroundServiceType': 'remoteMessaging'/)
    assert.match(backgroundService, /startForeground\(NOTIFICATION_ID, notification\)/)
    // Sticky, so one reclaim on a low-memory phone is not permanent.
    assert.match(backgroundService, /return START_STICKY/)
    assert.doesNotMatch(backgroundService, /START_NOT_STICKY/)
    assert.match(backgroundService, /onTaskRemoved/)
    // A one-minute sweep. Messages arrive over the live connection; a five
    // second wakeup loop is what an aggressive power manager kills first.
    const heartbeat = backgroundService.match(/HEARTBEAT_INTERVAL_MS = ([0-9_]+)L/)
    assert.ok(heartbeat, 'heartbeat interval not found')
    assert.ok(Number(heartbeat[1].replaceAll('_', '')) >= 60_000, 'heartbeat is too frequent')

    // A reboot or an app update must not end the background connection.
    assert.match(backgroundPlugin, /RECEIVE_BOOT_COMPLETED/)
    assert.match(backgroundPlugin, /PeerChatBootReceiver[.]kt/)
    const bootReceiver = await readFile(
      repoFile('plugins/templates/PeerChatBootReceiver.kt.template'),
      'utf8'
    )
    assert.match(bootReceiver, /ACTION_BOOT_COMPLETED/)
    assert.match(bootReceiver, /isWanted\(context\)/)
    // Android limits which service types may start from a boot broadcast, and
    // an uncaught refusal inside a receiver crashes the app at boot.
    assert.match(bootReceiver, /try \{[\s\S]*startForegroundService[\s\S]*catch \(error: Exception\)/)
    assert.match(backgroundService, /try \{[\s\S]*startForegroundService[\s\S]*catch \(error: Exception\)/)
    // The system broadcasts from its own uid, so a non-exported receiver never
    // runs. Both actions are protected broadcasts and cannot be forged.
    const { addPeerChatBackgroundManifest } = await import('../../plugins/with-peerchat-background.js')
    const manifest = addPeerChatBackgroundManifest({ application: [{}] })
    const receiver = manifest.application[0].receiver
      .find((entry) => entry.$['android:name'] === '.PeerChatBootReceiver')
    assert.equal(receiver.$['android:exported'], 'true')
    assert.deepEqual(
      receiver['intent-filter'][0].action.map((entry) => entry.$['android:name']),
      ['android.intent.action.BOOT_COMPLETED', 'android.intent.action.MY_PACKAGE_REPLACED']
    )

    // Samsung's sleeping apps layer sits above Doze, so this is asked for too.
    assert.match(backgroundModule, /isIgnoringBatteryOptimizations/)
    assert.match(backgroundModule, /ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS/)
    assert.match(backgroundModule, /SoundPool[.]Builder/)
    assert.match(backgroundModule, /USAGE_ASSISTANCE_SONIFICATION/)
    assert.match(backgroundModule, /PeerChatBackgroundTick/)
    assert.doesNotMatch(backgroundModule, /MediaSession/)
  })

  it('configures local discovery on Android and iOS', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    const plugins = appJson.expo?.plugins || []
    const infoPlist = appJson.expo?.ios?.infoPlist
    const plugin = await readFile(LAN_DISCOVERY_PLUGIN_FILE, 'utf8')
    const mainApplication = addMulticastLock(MAIN_APPLICATION_FIXTURE)

    assert.equal(hasExpoPlugin(plugins, LAN_DISCOVERY_PLUGIN), true)
    assert.equal(
      appJson.expo?.ios?.entitlements?.['com.apple.developer.networking.multicast'],
      true
    )
    assert.deepEqual(infoPlist?.NSBonjourServices, ['_hyperdht-mdns._udp'])
    assert.match(infoPlist?.NSLocalNetworkUsageDescription, /nearby PeerSky devices/)
    assert.match(plugin, /android\.permission\.CHANGE_WIFI_MULTICAST_STATE/)
    assert.match(plugin, /createMulticastLock\("peersky-hyperdht-mdns"\)/)
    assert.match(mainApplication, /import android\.content\.Context/)
    assert.match(mainApplication, /import android\.net\.wifi\.WifiManager/)
    assert.match(mainApplication, /private var lanMulticastLock: WifiManager\.MulticastLock\? = null/)
    assert.match(mainApplication, /createMulticastLock\("peersky-hyperdht-mdns"\)/)
    assert.match(mainApplication, /acquire\(\)/)
    assert.equal(addMulticastLock(mainApplication), mainApplication)
  })

  it('enables native WebView prompts for location and media capture', async () => {
    const indexSource = await readFile(repoFile('app/index.tsx'), 'utf8')

    assert.match(indexSource, /geolocationEnabled=\{true\}/)
    assert.match(indexSource, /mediaCapturePermissionGrantType='prompt'/)
  })

  it('enables native fullscreen video in user-facing WebViews', async () => {
    const indexSource = await readFile(repoFile('app/index.tsx'), 'utf8')

    assert.equal(indexSource.match(/allowsFullscreenVideo=\{true\}/g)?.length, 2)
  })

  it('stores P2PMD peer names outside the room WebView origin', async () => {
    const indexSource = await readFile(repoFile('app/index.tsx'), 'utf8')

    assert.match(indexSource, /new File\(Paths\.document, 'p2pmd-profile\.json'\)/)
    assert.match(indexSource, /action === 'peer-profile'/)
    assert.match(indexSource, /window\.__P2PMD_DISPLAY_NAME__/)
    assert.match(indexSource, /replace\(\/<\/g, '\\\\u003c'\)/)
  })

  it('opens incoming Android web and Hyper links after browser startup completes', async () => {
    const indexSource = await readFile(repoFile('app/index.tsx'), 'utf8')

    assert.match(indexSource, /subscribeToIncomingUrls\(\(url\) => \{/)
    assert.match(indexSource, /!isWebUrl\(url\) && !isHyperUrl\(url\)/)
    assert.match(indexSource, /if \(!browserSessionReady \|\| !pendingIncomingUrl\) return/)
    assert.match(indexSource, /void loadBrowserUrl\(incomingUrl\)/)
    // The browser says when it has dealt with one, so a link that arrived on
    // the way to expo-router's unmatched route is not lost with the screen.
    assert.match(indexSource, /settleIncomingUrl\(incomingUrl\)/)
  })

  // expo-router parsed every incoming link's query with a decoder a crafted
  // link could keep busy. The browser reads links itself, so the router is
  // only ever told to show "/".
  it('keeps system links away from expo-router', async () => {
    const intent = await readFile(repoFile('app/+native-intent.ts'), 'utf8')
    assert.match(intent, /export function redirectSystemPath \(\{ initial \}/)
    assert.match(intent, /return initial \? '\/' : null/)
  })

  it('listens for deep links outside the screen expo-router unmounts', async () => {
    const linksSource = await readFile(repoFile('app/incoming-links.ts'), 'utf8')

    assert.match(linksSource, /Linking\.getInitialURL\(\)/)
    assert.match(linksSource, /Linking\.addEventListener\('url'/)
    // Module scope, not inside a hook or a component, so it survives the
    // unmount and remount a peersky:// link causes.
    assert.doesNotMatch(linksSource, /useEffect|export default function/)
  })

  it('bundles the Bare backend before native Android/iOS runs', async () => {
    const packageJson = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))
    const scripts = packageJson.scripts || {}

    assert.equal(scripts.preandroid, 'npm run bundle:bare')
    assert.equal(scripts.preios, 'npm run bundle:bare')
    assert.match(scripts['bundle:bare'], /bare-pack/)
    assert.match(scripts['bundle:bare'], /update:content-blocking-snapshot/)
    assert.match(scripts['bundle:bare'], /--host android-arm64/)
    assert.match(scripts['bundle:bare'], /--host android-x64/)
    assert.match(scripts['bundle:bare'], /--host ios-arm64/)
    assert.match(scripts['bundle:bare'], /--host ios-arm64-simulator/)
    assert.match(scripts['bundle:bare'], /--imports backend\/bare-imports\.json/)
    assert.match(scripts['bundle:bare'], /backend\/backend\.mjs/)
  })

  it('keeps required Bare import aliases explicit', async () => {
    const imports = JSON.parse(await readFile(repoFile('backend/bare-imports.json'), 'utf8'))

    assert.deepEqual(imports, {
      'bare-abort-controller': 'bare-abort-controller',
      buffer: 'bare-buffer',
      crypto: 'bare-crypto',
      dgram: 'bare-dgram',
      events: 'bare-events',
      fs: 'bare-fs',
      net: 'bare-net',
      'node:crypto': 'bare-crypto',
      'node:fs': 'bare-fs',
      'node:stream': 'bare-stream',
      'node:stream/promises': 'bare-stream/promises',
      'node:zlib': 'bare-zlib',
      os: 'bare-os'
    })
  })

  it('includes the LAN discovery runtime dependency', async () => {
    const packageJson = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))

    assert.equal(packageJson.dependencies?.['@p2plabs/hyperdht-mdns'], '^1.3.0')
    assert.equal(typeof packageJson.dependencies?.['bare-abort-controller'], 'string')
    assert.equal(typeof packageJson.dependencies?.['bare-buffer'], 'string')
    assert.equal(typeof packageJson.dependencies?.['bare-dgram'], 'string')
    assert.equal(typeof packageJson.dependencies?.['bare-net'], 'string')
    assert.equal(typeof packageJson.dependencies?.['expo-audio'], 'string')
    assert.equal(typeof packageJson.dependencies?.['bare-os'], 'string')
    assert.equal(typeof packageJson.dependencies?.['bare-process'], 'string')
  })

  it('installs Bare globals before loading Node-oriented dependencies', async () => {
    const backend = await readFile(repoFile('backend/backend.mjs'), 'utf8')
    const globals = await readFile(repoFile('backend/bare-globals.mjs'), 'utf8')

    assert.match(backend, /^import '\.\/bare-globals\.mjs'/)
    assert.match(backend, /import\('\.\/main\.mjs'\)/)
    assert.doesNotMatch(backend, /from '\.\/hyper\/runtime\.mjs'/)
    assert.match(globals, /import 'bare-process\/global'/)
  })

  it('does not reopen Hyper storage during a React effect remount', async () => {
    const indexSource = await readFile(repoFile('app/index.tsx'), 'utf8')

    assert.match(indexSource, /const generation = \+\+workletGenerationRef\.current/)
    assert.match(indexSource, /setTimeout\(\(\) => \{/)
    assert.match(indexSource, /workletGenerationRef\.current !== generation/)
    assert.match(indexSource, /worklet\?\.terminate\(\)/)
  })

  it('logs backend cleanup failures during Bare shutdown', async () => {
    const backend = await readFile(repoFile('backend/main.mjs'), 'utf8')

    assert.match(backend, /Bare\.on\('beforeExit'/)
    assert.match(backend, /disconnectP2pmdRoom\(\)/)
    assert.match(backend, /stopHolesail\(\)/)
    assert.match(backend, /closeHyperRuntime\(\)/)
    assert.match(backend, /console\.error\('\[p2pmd\] Failed to disconnect room on beforeExit:'/)
    assert.match(backend, /console\.error\('\[holesail\] Failed to stop runtime on beforeExit:'/)
    assert.match(backend, /console\.error\('\[hyper\] Failed to close runtime on beforeExit:'/)
  })
})

function hasExpoPlugin (plugins, pluginName) {
  return plugins.some((plugin) => {
    if (plugin === pluginName) return true
    return Array.isArray(plugin) && plugin[0] === pluginName
  })
}

function repoFile (relativePath) {
  return new URL(relativePath, REPO_ROOT)
}

const MAIN_APPLICATION_FIXTURE = `package xyz.p2plabs.peersky

import android.app.Application
import com.facebook.react.ReactApplication

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
  }
}
`
