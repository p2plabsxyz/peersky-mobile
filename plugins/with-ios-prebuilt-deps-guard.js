const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

// React Native's prebuilt core links ReactNativeDependencies.framework. When
// use_react_native! cannot reach that prebuilt on Maven (a curl check that a
// passing network hiccup fails), it quietly builds the dependencies from
// source instead. The build still succeeds, nothing embeds the framework, and
// the app dies at launch with "Library not loaded": 0.1.2 build 3 went to App
// Store Connect that way. pod install stops instead.
const MARKER = '[PeerSky] ReactNativeDependencies is missing'

const POST_INSTALL_GUARD = `
    # React Native's prebuilt core links ReactNativeDependencies.framework.
    # When the check for that prebuilt on Maven fails, use_react_native! builds
    # the dependencies from source instead and nothing embeds the framework, so
    # the app would die at launch. Stop rather than build that.
    pod_names = installer.pod_targets.map(&:name)
    if pod_names.include?('React-Core-prebuilt') && !pod_names.include?('ReactNativeDependencies')
      raise Pod::Informative, '${MARKER} while React Native itself is prebuilt, so the app would crash at launch. The check for it on Maven failed (see "[ReactNativeDependencies]" above). Run pod install again once https://repo1.maven.org answers.'
    end
`

const ANCHOR = '      :ccache_enabled => ccache_enabled?(podfile_properties),\n    )\n'

/** The Podfile with the guard after react_native_post_install, added once. */
function addPrebuiltDepsGuard (podfile) {
  if (podfile.includes(MARKER)) return podfile
  if (!podfile.includes(ANCHOR)) {
    throw new Error('with-ios-prebuilt-deps-guard: react_native_post_install anchor not found in Podfile')
  }
  return podfile.replace(ANCHOR, ANCHOR + POST_INSTALL_GUARD)
}

module.exports = function withIosPrebuiltDepsGuard (config) {
  return withDangerousMod(config, ['ios', async (iosConfig) => {
    const podfilePath = path.join(iosConfig.modRequest.platformProjectRoot, 'Podfile')
    fs.writeFileSync(podfilePath, addPrebuiltDepsGuard(fs.readFileSync(podfilePath, 'utf8')))
    return iosConfig
  }])
}

module.exports.addPrebuiltDepsGuard = addPrebuiltDepsGuard
module.exports.MARKER = MARKER
