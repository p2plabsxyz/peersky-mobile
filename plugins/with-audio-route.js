const fs = require('node:fs')
const path = require('node:path')
const {
  IOSConfig,
  withDangerousMod,
  withMainApplication,
  withXcodeProject
} = require('@expo/config-plugins')

// A small native module that says whether sound is going to a Bluetooth
// device, for PeerTunes' Bluetooth mark.

const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')
const IOS_GROUP_NAME = 'PeerSkyAudioRoute'
const IOS_SOURCE = 'PeerSkyAudioRoute.m'
const PACKAGE_REGISTRATION = 'add(PeerSkyAudioRoutePackage())'

module.exports = function withAudioRoute (config) {
  config = withDangerousMod(config, ['ios', (config) => {
    const destination = path.join(config.modRequest.platformProjectRoot, IOS_GROUP_NAME)
    fs.mkdirSync(destination, { recursive: true })
    fs.copyFileSync(path.join(TEMPLATE_DIRECTORY, `${IOS_SOURCE}.template`), path.join(destination, IOS_SOURCE))
    return config
  }])

  config = withXcodeProject(config, (config) => {
    const project = config.modResults
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, IOS_GROUP_NAME)
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: path.join(IOS_GROUP_NAME, IOS_SOURCE),
      groupName: IOS_GROUP_NAME,
      project
    })
    return config
  })

  config = withDangerousMod(config, ['android', (config) => {
    const packageName = config.android?.package
    if (!packageName) throw new Error('The audio route module needs an Android package name.')
    const destination = path.join(config.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'))
    fs.mkdirSync(destination, { recursive: true })
    for (const filename of ['PeerSkyAudioRouteModule.kt', 'PeerSkyAudioRoutePackage.kt']) {
      const source = fs.readFileSync(path.join(TEMPLATE_DIRECTORY, `${filename}.template`), 'utf8')
        .replaceAll('__PACKAGE_NAME__', packageName)
      fs.writeFileSync(path.join(destination, filename), source)
    }
    return config
  }])

  return withMainApplication(config, (config) => {
    const marker = 'PackageList(this).packages.apply {'
    if (!config.modResults.contents.includes(marker)) throw new Error('Unable to register the audio route package.')
    if (!config.modResults.contents.includes(PACKAGE_REGISTRATION)) {
      config.modResults.contents = config.modResults.contents.replace(marker, `${marker}\n          ${PACKAGE_REGISTRATION}`)
    }
    return config
  })
}
