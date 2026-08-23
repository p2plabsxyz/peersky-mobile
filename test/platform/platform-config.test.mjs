import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const ANDROID_LOOPBACK_CLEARTEXT_PLUGIN = './plugins/with-android-loopback-cleartext'
const LAN_DISCOVERY_PLUGIN = './plugins/with-lan-discovery'
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
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECORD_AUDIO'
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
  })

  it('configures local discovery on Android and iOS', async () => {
    const appJson = JSON.parse(await readFile(repoFile('app.json'), 'utf8'))
    const plugins = appJson.expo?.plugins || []
    const infoPlist = appJson.expo?.ios?.infoPlist
    const plugin = await readFile(LAN_DISCOVERY_PLUGIN_FILE, 'utf8')
    const mainApplication = await readFile(
      repoFile('android/app/src/main/java/xyz/p2plabs/peersky/MainApplication.kt'),
      'utf8'
    )

    assert.equal(hasExpoPlugin(plugins, LAN_DISCOVERY_PLUGIN), true)
    assert.equal(
      appJson.expo?.ios?.entitlements?.['com.apple.developer.networking.multicast'],
      true
    )
    assert.deepEqual(infoPlist?.NSBonjourServices, ['_hyperdht-mdns._udp'])
    assert.match(infoPlist?.NSLocalNetworkUsageDescription, /nearby PeerSky devices/)
    assert.match(plugin, /android\.permission\.CHANGE_WIFI_MULTICAST_STATE/)
    assert.match(plugin, /createMulticastLock\("peersky-hyperdht-mdns"\)/)
    assert.match(mainApplication, /createMulticastLock\("peersky-hyperdht-mdns"\)/)
    assert.match(mainApplication, /acquire\(\)/)
  })

  it('enables native WebView prompts for location and media capture', async () => {
    const indexSource = await readFile(repoFile('app/index.tsx'), 'utf8')

    assert.match(indexSource, /geolocationEnabled=\{true\}/)
    assert.match(indexSource, /mediaCapturePermissionGrantType='prompt'/)
  })

  it('opens incoming Android web and Hyper links after browser startup completes', async () => {
    const indexSource = await readFile(repoFile('app/index.tsx'), 'utf8')

    assert.match(indexSource, /Linking\.getInitialURL\(\)/)
    assert.match(indexSource, /Linking\.addEventListener\('url'/)
    assert.match(indexSource, /!isWebUrl\(url\) && !isHyperUrl\(url\)/)
    assert.match(indexSource, /if \(!browserSessionReady \|\| !pendingIncomingUrl\) return/)
    assert.match(indexSource, /void loadBrowserUrl\(incomingUrl\)/)
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
      buffer: 'bare-buffer',
      crypto: 'bare-crypto',
      dgram: 'bare-dgram',
      events: 'bare-events',
      net: 'bare-net',
      'node:crypto': 'bare-crypto',
      'node:zlib': 'bare-zlib',
      os: 'bare-os'
    })
  })

  it('includes the LAN discovery runtime dependency', async () => {
    const packageJson = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))

    assert.equal(packageJson.dependencies?.['@p2plabs/hyperdht-mdns'], '^1.0.0')
    assert.equal(typeof packageJson.dependencies?.['bare-buffer'], 'string')
    assert.equal(typeof packageJson.dependencies?.['bare-dgram'], 'string')
    assert.equal(typeof packageJson.dependencies?.['bare-net'], 'string')
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
