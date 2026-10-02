const { withAppBuildGradle } = require('@expo/config-plugins')

// react-native-bare-kit packages prebuilt addons for every version of a native
// module, linked or not. libsodium-native.4.3.3.so is a leftover: the tree
// resolves only sodium-native 5.1.0 (the sodium-universal override in
// package.json), so nothing links to it and dropping it is safe. It is the one
// library with 4 KB LOAD alignment, which puts the whole app in page size
// compatibility mode on a 16 KB device, and Google Play requires 16 KB support.
// Remove this plugin once react-native-bare-kit stops shipping the old build.
const EXCLUDED_LIBRARIES = ['**/libsodium-native.4.3.3.so']

const MARKER = 'PeerSky 16 KB page size'

function addJniLibExcludes (contents) {
  if (contents.includes(MARKER)) return contents

  const block = [
    '',
    'android {',
    '    packagingOptions {',
    '        jniLibs {',
    `            // ${MARKER}: drop stale 4 KB aligned prebuilts nothing links to.`,
    ...EXCLUDED_LIBRARIES.map((pattern) => `            excludes += '${pattern}'`),
    '        }',
    '    }',
    '}',
    ''
  ].join('\n')

  return `${contents.trimEnd()}\n${block}`
}

module.exports = function withAndroid16kbLibs (config) {
  return withAppBuildGradle(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'groovy') {
      throw new Error('The 16 KB alignment plugin expects a Groovy app/build.gradle.')
    }
    androidConfig.modResults.contents = addJniLibExcludes(androidConfig.modResults.contents)
    return androidConfig
  })
}

module.exports.addJniLibExcludes = addJniLibExcludes
module.exports.EXCLUDED_LIBRARIES = EXCLUDED_LIBRARIES
