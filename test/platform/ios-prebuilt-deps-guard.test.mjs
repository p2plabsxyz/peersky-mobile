import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'

// 0.1.2 build 3 went to App Store Connect without ReactNativeDependencies.framework:
// the Maven check in use_react_native! failed once, the dependencies were built
// from source, and the app died at launch with "Library not loaded".
const require = createRequire(import.meta.url)
const { addPrebuiltDepsGuard, MARKER } = require('../../plugins/with-ios-prebuilt-deps-guard.js')
const appJson = JSON.parse(await readFile(new URL('../../app.json', import.meta.url), 'utf8'))

// The end of react_native_post_install, as Expo's Podfile template has it.
const PODFILE = `post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
`

function hasRuby () {
  try {
    execFileSync('ruby', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('iOS pods with React Native prebuilt', () => {
  test('the guard is registered and goes after react_native_post_install, once', () => {
    assert.ok(appJson.expo.plugins.includes('./plugins/with-ios-prebuilt-deps-guard'))
    const once = addPrebuiltDepsGuard(PODFILE)
    assert.ok(once.indexOf(MARKER) > once.indexOf(':ccache_enabled'))
    assert.ok(once.indexOf(MARKER) < once.lastIndexOf('\n  end'))
    assert.equal(addPrebuiltDepsGuard(once), once)
    assert.throws(() => addPrebuiltDepsGuard('post_install do |installer|\n  end\n'), /anchor not found/)
  })

  test('pod install stops when the prebuilt core came without its prebuilt dependencies', { skip: !hasRuby() && 'no ruby here' }, () => {
    const podfile = addPrebuiltDepsGuard(PODFILE)
    const guard = podfile.slice(podfile.indexOf('    # React Native'), podfile.lastIndexOf('\n  end'))
    // The inserted Ruby, run against a stand-in for CocoaPods' installer.
    const script = `module Pod; class Informative < StandardError; end; end
Target = Struct.new(:name)
Installer = Struct.new(:pod_targets)
def run (names)
  installer = Installer.new(names.map { |n| Target.new(n) })
${guard}
  'ok'
rescue Pod::Informative => e
  'refused: ' + e.message
end
puts run(['React-Core-prebuilt', 'ReactNativeDependencies', 'hermes-engine'])
puts run(['React-Core-prebuilt', 'RCT-Folly', 'glog', 'boost'])
puts run(['React-Core', 'RCT-Folly', 'glog', 'boost'])
`
    const [prebuilt, mixed, fromSource] = execFileSync('ruby', ['-e', script], { encoding: 'utf8' }).trim().split('\n')
    assert.equal(prebuilt, 'ok')
    assert.ok(mixed.startsWith(`refused: ${MARKER}`), mixed)
    // All from source has nothing prebuilt that could miss its frameworks.
    assert.equal(fromSource, 'ok')
  })
})
