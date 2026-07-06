import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const ANDROID_LOOPBACK_CLEARTEXT_PLUGIN = './plugins/with-android-loopback-cleartext'
const REPO_ROOT = new URL('../../', import.meta.url)
const ANDROID_LOOPBACK_CLEARTEXT_PLUGIN_FILE = repoFile('plugins/with-android-loopback-cleartext.js')

describe('mobile platform runtime configuration', () => {
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

  it('bundles the Bare backend before native Android/iOS runs', async () => {
    const packageJson = JSON.parse(await readFile(repoFile('package.json'), 'utf8'))
    const scripts = packageJson.scripts || {}

    assert.equal(scripts.preandroid, 'npm run bundle:bare')
    assert.equal(scripts.preios, 'npm run bundle:bare')
    assert.match(scripts['bundle:bare'], /bare-pack/)
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
      'node:crypto': 'bare-crypto'
    })
  })

  it('logs backend cleanup failures during Bare shutdown', async () => {
    const backend = await readFile(repoFile('backend/backend.mjs'), 'utf8')

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
