const fs = require('node:fs')
const path = require('node:path')
const {
  IOSConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withXcodeProject
} = require('@expo/config-plugins')

// A small native module that says whether sound is going to a Bluetooth
// device, for PeerTunes' Bluetooth mark. On Android it also holds PeerTunes'
// media session, and a service keeps a song playing with the screen off or
// another app in front, which Android otherwise stops by freezing the app.

const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')
const IOS_GROUP_NAME = 'PeerSkyAudioRoute'
const IOS_SOURCE = 'PeerSkyAudioRoute.m'
const PACKAGE_REGISTRATION = 'add(PeerSkyAudioRoutePackage())'
const PLAYBACK_SERVICE_NAME = '.PeerTunesPlaybackService'
const PLAYBACK_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'
]

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
    for (const filename of ['PeerSkyAudioRouteModule.kt', 'PeerSkyAudioRoutePackage.kt', 'PeerTunesPlaybackService.kt']) {
      const source = fs.readFileSync(path.join(TEMPLATE_DIRECTORY, `${filename}.template`), 'utf8')
        .replaceAll('__PACKAGE_NAME__', packageName)
      fs.writeFileSync(path.join(destination, filename), source)
    }
    return config
  }])

  config = withAndroidManifest(config, (config) => {
    config.modResults.manifest = addPeerTunesPlaybackManifest(config.modResults.manifest)
    return config
  })

  return withMainApplication(config, (config) => {
    const marker = 'PackageList(this).packages.apply {'
    if (!config.modResults.contents.includes(marker)) throw new Error('Unable to register the audio route package.')
    if (!config.modResults.contents.includes(PACKAGE_REGISTRATION)) {
      config.modResults.contents = config.modResults.contents.replace(marker, `${marker}\n          ${PACKAGE_REGISTRATION}`)
    }
    return config
  })
}

// The playback service and what it needs: typed mediaPlayback, which the Play
// Console asks the app to declare, and not reachable from other apps.
function addPeerTunesPlaybackManifest (manifest) {
  const permissions = manifest['uses-permission'] || []
  for (const permission of PLAYBACK_PERMISSIONS) {
    if (!permissions.some((entry) => entry.$?.['android:name'] === permission)) {
      permissions.push({ $: { 'android:name': permission } })
    }
  }
  manifest['uses-permission'] = permissions

  const application = manifest.application?.[0]
  if (!application) throw new Error('Android application manifest entry is missing.')
  const services = (application.service || []).filter((entry) => entry.$?.['android:name'] !== PLAYBACK_SERVICE_NAME)
  services.push({
    $: {
      'android:name': PLAYBACK_SERVICE_NAME,
      'android:exported': 'false',
      'android:foregroundServiceType': 'mediaPlayback'
    }
  })
  application.service = services
  return manifest
}

module.exports.addPeerTunesPlaybackManifest = addPeerTunesPlaybackManifest
