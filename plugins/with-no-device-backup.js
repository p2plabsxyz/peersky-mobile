const {
  IOSConfig,
  withAndroidManifest,
  withDangerousMod,
  withXcodeProject
} = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

// Keys, chats and P2P stores stay on the phone they were made on. A cloud
// backup or a phone-to-phone copy restored them onto a second phone that then
// wrote to the same feeds, and put the cached P2P data of every drive ever
// opened into the user's iCloud. Link Device and the app's own encrypted backup
// move them on purpose instead.

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </device-transfer>
</data-extraction-rules>
`

const IOS_SOURCE = 'PeerSkyBackupExclusion.m'

module.exports = function withNoDeviceBackup (config) {
  config = withAndroidManifest(config, (androidConfig) => {
    const attributes = androidConfig.modResults.manifest.application?.[0]?.$
    if (attributes) {
      // allowBackup stops cloud backup and adb. Android 12 and later still
      // copy apps phone to phone unless the extraction rules say otherwise.
      attributes['android:allowBackup'] = 'false'
      attributes['android:dataExtractionRules'] = '@xml/data_extraction_rules'
      delete attributes['android:fullBackupContent']
    }
    return androidConfig
  })

  config = withDangerousMod(config, ['android', async (androidConfig) => {
    const directory = path.join(androidConfig.modRequest.platformProjectRoot, 'app/src/main/res/xml')
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, 'data_extraction_rules.xml'), DATA_EXTRACTION_RULES)
    return androidConfig
  }])

  config = withDangerousMod(config, ['ios', async (iosConfig) => {
    const { platformProjectRoot, projectRoot } = iosConfig.modRequest
    const target = path.join(platformProjectRoot, IOSConfig.XcodeUtils.getProjectName(projectRoot), IOS_SOURCE)
    fs.copyFileSync(path.join(__dirname, 'templates', `${IOS_SOURCE}.template`), target)
    return iosConfig
  }])

  return withXcodeProject(config, (iosConfig) => {
    const groupName = IOSConfig.XcodeUtils.getProjectName(iosConfig.modRequest.projectRoot)
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: path.join(groupName, IOS_SOURCE),
      groupName,
      project: iosConfig.modResults
    })
    return iosConfig
  })
}
