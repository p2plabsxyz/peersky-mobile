const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

// A link shared to PeerSky from another app opens in PeerSky, the way other
// browsers take one from the share sheet. A small activity with no window
// takes the share, finds the link in it, and opens the app with that link
// as if it had been tapped, which app/incoming-links.ts already handles.
//
// Android only. iOS takes a share extension for this.
const ACTIVITY_NAME = '.ShareToOpenActivity'
const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')
const SOURCE_FILE = 'ShareToOpenActivity.kt'
const TEST_FILE = 'ShareToOpenActivityTest.kt'

function addShareToOpenActivity (manifest) {
  const application = manifest.manifest.application?.[0]
  if (!application) throw new Error('Unable to find the application to open shared links in.')
  application.activity = application.activity || []
  if (application.activity.some((activity) => activity.$?.['android:name'] === ACTIVITY_NAME)) return manifest

  application.activity.push({
    $: {
      'android:name': ACTIVITY_NAME,
      'android:exported': 'true',
      'android:excludeFromRecents': 'true',
      'android:noHistory': 'true',
      'android:taskAffinity': '',
      'android:theme': '@android:style/Theme.Translucent.NoTitleBar'
    },
    'intent-filter': [{
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }]
    }]
  })
  return manifest
}

module.exports = function withShareToOpen (config) {
  config = withAndroidManifest(config, (androidConfig) => {
    androidConfig.modResults = addShareToOpenActivity(androidConfig.modResults)
    return androidConfig
  })

  return withDangerousMod(config, ['android', async (androidConfig) => {
    const packageName = androidConfig.android?.package
    if (!packageName) throw new Error('Android package name is required to open shared links.')
    const sourceDirectory = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app/src/main/java',
      ...packageName.split('.')
    )
    const testDirectory = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app/src/test/java',
      ...packageName.split('.')
    )
    writeFromTemplate(sourceDirectory, SOURCE_FILE, packageName)
    writeFromTemplate(testDirectory, TEST_FILE, packageName)
    return androidConfig
  }])
}

function writeFromTemplate (directory, filename, packageName) {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, filename),
    fs.readFileSync(path.join(TEMPLATE_DIRECTORY, `${filename}.template`), 'utf8')
      .replaceAll('__PACKAGE_NAME__', packageName)
  )
}

module.exports.addShareToOpenActivity = addShareToOpenActivity
