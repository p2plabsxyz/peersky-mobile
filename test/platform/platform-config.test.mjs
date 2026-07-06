import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const ANDROID_MANIFEST = 'android/app/src/main/AndroidManifest.xml'
const ANDROID_NETWORK_SECURITY = 'android/app/src/main/res/xml/network_security_config.xml'

describe('mobile platform runtime configuration', () => {
  it('keeps Android cleartext scoped to loopback only', async () => {
    const manifest = await readFile(ANDROID_MANIFEST, 'utf8')
    const networkSecurity = await readFile(ANDROID_NETWORK_SECURITY, 'utf8')

    assert.match(manifest, /android:networkSecurityConfig="@xml\/network_security_config"/)
    assert.doesNotMatch(manifest, /android:usesCleartextTraffic="true"/)
    assert.match(networkSecurity, /<base-config\s+cleartextTrafficPermitted="false"\s*\/>/)
    assert.match(networkSecurity, /<domain-config\s+cleartextTrafficPermitted="true">/)
    assert.match(networkSecurity, /<domain\s+includeSubdomains="false">localhost<\/domain>/)
    assert.match(networkSecurity, /<domain\s+includeSubdomains="false">127\.0\.0\.1<\/domain>/)
    assert.doesNotMatch(networkSecurity, /0\.0\.0\.0/)
    assert.doesNotMatch(networkSecurity, /192\.168\./)
    assert.doesNotMatch(networkSecurity, /cleartextTrafficPermitted="true"[\s\S]*<base-config/)
  })

  it('keeps iOS local networking scoped to localhost support, not arbitrary HTTP', async () => {
    const appJson = JSON.parse(await readFile('app.json', 'utf8'))
    const ats = appJson.expo?.ios?.infoPlist?.NSAppTransportSecurity

    assert.equal(ats?.NSAllowsLocalNetworking, true)
    assert.notEqual(ats?.NSAllowsArbitraryLoads, true)
  })

  it('bundles the Bare backend before native Android/iOS runs', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
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
    const imports = JSON.parse(await readFile('backend/bare-imports.json', 'utf8'))

    assert.deepEqual(imports, {
      'node:crypto': 'bare-crypto'
    })
  })

  it('logs backend cleanup failures during Bare shutdown', async () => {
    const backend = await readFile('backend/backend.mjs', 'utf8')

    assert.match(backend, /Bare\.on\('beforeExit'/)
    assert.match(backend, /disconnectP2pmdRoom\(\)/)
    assert.match(backend, /stopHolesail\(\)/)
    assert.match(backend, /closeHyperRuntime\(\)/)
    assert.match(backend, /console\.error\('\[p2pmd\] Failed to disconnect room on beforeExit:'/)
    assert.match(backend, /console\.error\('\[holesail\] Failed to stop runtime on beforeExit:'/)
    assert.match(backend, /console\.error\('\[hyper\] Failed to close runtime on beforeExit:'/)
  })
})
