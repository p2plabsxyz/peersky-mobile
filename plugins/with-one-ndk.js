const { withProjectBuildGradle } = require('@expo/config-plugins')

// Every Android library builds with the one NDK Expo picks (rootProject's
// ndkVersion). A library that names none, like react-native-b4a, otherwise
// gets the Android Gradle Plugin's own default, a second NDK that Gradle
// downloads by itself mid-build without checking the archive. On CI that
// download arrived cut short and failed the build ("Error on ZipFile unknown
// archive"); CI installs the one NDK up front with sdkmanager, which does
// check it.
const MARKER = 'PeerSky one NDK'

function pinLibraryNdk (contents) {
  if (contents.includes(MARKER)) return contents

  const block = [
    '',
    `// ${MARKER}: libraries that name no NDK build with the app's.`,
    'subprojects { project ->',
    "  project.plugins.withId('com.android.library') {",
    '    project.android.ndkVersion = rootProject.ext.ndkVersion',
    '  }',
    '}',
    ''
  ].join('\n')

  return `${contents.trimEnd()}\n${block}`
}

module.exports = function withOneNdk (config) {
  return withProjectBuildGradle(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'groovy') {
      throw new Error('The one NDK plugin expects a Groovy build.gradle.')
    }
    androidConfig.modResults.contents = pinLibraryNdk(androidConfig.modResults.contents)
    return androidConfig
  })
}

module.exports.pinLibraryNdk = pinLibraryNdk
