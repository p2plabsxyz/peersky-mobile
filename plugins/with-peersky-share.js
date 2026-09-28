const { IOSConfig, withDangerousMod, withXcodeProject } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

// React Native's Share hands iOS a bare string, and the share sheet has
// nothing to draw a header from. For a hyper:// link iOS cannot fetch anything
// either, so it shows a blank page glyph. This adds a module that presents the
// sheet through UIActivityItemSource with LPLinkMetadata carrying the app
// icon.
//
// iOS only. Android's share sheet already labels the share with the sending
// app's own icon.
const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')
const GROUP_NAME = 'PeerSkyShare'
const SOURCE_FILE = 'PeerSkyShareModule.m'

module.exports = function withPeerSkyShare (config) {
  config = withDangerousMod(config, ['ios', async (iosConfig) => {
    const sourceDirectory = path.join(iosConfig.modRequest.platformProjectRoot, GROUP_NAME)
    fs.mkdirSync(sourceDirectory, { recursive: true })
    fs.copyFileSync(
      path.join(TEMPLATE_DIRECTORY, `${SOURCE_FILE}.template`),
      path.join(sourceDirectory, SOURCE_FILE)
    )
    return iosConfig
  }])

  return withXcodeProject(config, (iosConfig) => {
    const project = iosConfig.modResults
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, GROUP_NAME)
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: path.join(GROUP_NAME, SOURCE_FILE),
      groupName: GROUP_NAME,
      project
    })
    return iosConfig
  })
}
