const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {
  AndroidConfig,
  IOSConfig,
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
  withMainApplication,
  withXcodeProject
} = require('@expo/config-plugins')

const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')
const IOS_GROUP_NAME = 'PeerSkyAppIcon'
const PACKAGE_REGISTRATION = 'add(PeerSkyAppIconPackage())'

// Kept in step with app/app-logo-colors.mjs: the picker offers these ids and
// the launcher has to have an icon under each one.
const COLORS = ['cyan', 'green', 'violet', 'yellow', 'light', 'dark']

// iOS reads alternate icons off plain files in the bundle rather than from the
// asset catalog, at the two sizes a home screen actually draws.
const IOS_SIZES = [
  { scale: 2, size: 120 },
  { scale: 3, size: 180 }
]

const ANDROID_DENSITIES = [
  { name: 'mdpi', size: 108 },
  { name: 'hdpi', size: 162 },
  { name: 'xhdpi', size: 216 },
  { name: 'xxhdpi', size: 324 },
  { name: 'xxxhdpi', size: 432 }
]

module.exports = function withAppIcons (config) {
  config = withIosAlternateIcons(config)
  config = withIosIconFiles(config)
  config = withIosModule(config)
  config = withAndroidAlternateIcons(config)
  config = withAndroidAliases(config)
  config = withAndroidModule(config)
  return config
}

function withIosModule (config) {
  config = withDangerousMod(config, ['ios', (config) => {
    const destination = path.join(config.modRequest.platformProjectRoot, IOS_GROUP_NAME)
    fs.mkdirSync(destination, { recursive: true })
    for (const filename of ['PeerSkyAppIcon.h', 'PeerSkyAppIcon.m']) {
      fs.copyFileSync(
        path.join(TEMPLATE_DIRECTORY, `${filename}.template`),
        path.join(destination, filename)
      )
    }
    return config
  }])

  return withXcodeProject(config, (config) => {
    const project = config.modResults
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, IOS_GROUP_NAME)
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: path.join(IOS_GROUP_NAME, 'PeerSkyAppIcon.m'),
      groupName: IOS_GROUP_NAME,
      project
    })
    return config
  })
}

function withAndroidModule (config) {
  config = withDangerousMod(config, ['android', (config) => {
    const packageName = config.android?.package
    if (!packageName) throw new Error('Alternate app icons need an Android package name.')

    const destination = path.join(
      config.modRequest.platformProjectRoot,
      'app/src/main/java',
      ...packageName.split('.')
    )
    fs.mkdirSync(destination, { recursive: true })

    // The alias list lives in one place, so the module can never offer a
    // colour the manifest has no alias for.
    const aliases = COLORS.map((color) => JSON.stringify(color)).join(', ')
    for (const filename of ['PeerSkyAppIconModule.kt', 'PeerSkyAppIconPackage.kt']) {
      const source = fs.readFileSync(path.join(TEMPLATE_DIRECTORY, `${filename}.template`), 'utf8')
        .replaceAll('__PACKAGE_NAME__', packageName)
        .replaceAll('__ALIASES__', aliases)
        .replaceAll('__DEFAULT_ALIAS__', JSON.stringify(COLORS[0]))
      fs.writeFileSync(path.join(destination, filename), source)
    }
    return config
  }])

  return withMainApplication(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error('Alternate app icons require a Kotlin MainApplication.')
    }
    config.modResults.contents = addAppIconPackage(config.modResults.contents)
    return config
  })
}

function addAppIconPackage (contents) {
  const marker = 'PackageList(this).packages.apply {'
  if (!contents.includes(marker)) throw new Error('Unable to register the app icon package.')
  if (contents.includes(PACKAGE_REGISTRATION)) return contents
  return contents.replace(marker, `${marker}\n          ${PACKAGE_REGISTRATION}`)
}

function iosIconName (color) {
  return `AppIcon-${color}`
}

function aliasName (color) {
  return `.MainActivity${color.charAt(0).toUpperCase()}${color.slice(1)}`
}

// Scaling through sips keeps this to tools every macOS build machine has, and
// Linux CI never builds the iOS half anyway.
function resize (source, destination, size) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  execFileSync('sips', [
    '-s', 'format', 'png',
    '-z', String(size), String(size),
    source,
    '--out', destination
  ], { stdio: 'ignore' })
}

function withIosIconFiles (config) {
  return withDangerousMod(config, ['ios', (config) => {
    const projectRoot = config.modRequest.projectRoot
    const platformRoot = config.modRequest.platformProjectRoot
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot)
    const destination = path.join(platformRoot, projectName, 'AlternateIcons')
    fs.mkdirSync(destination, { recursive: true })

    for (const color of COLORS) {
      const source = path.join(projectRoot, 'assets/app-icons/ios', `${color}.png`)
      for (const { scale, size } of IOS_SIZES) {
        const suffix = scale === 1 ? '' : `@${scale}x`
        resize(source, path.join(destination, `${iosIconName(color)}${suffix}.png`), size)
      }
    }
    return config
  }])
}

function withIosAlternateIcons (config) {
  config = withInfoPlist(config, (config) => {
    const icons = config.modResults.CFBundleIcons || {}
    const alternates = {}

    for (const color of COLORS) {
      alternates[color] = {
        CFBundleIconFiles: [iosIconName(color)],
        UIPrerenderedIcon: false
      }
    }

    config.modResults.CFBundleIcons = { ...icons, CFBundleAlternateIcons: alternates }
    return config
  })

  // The files have to be in Copy Bundle Resources, not merely on disk, or
  // setAlternateIconName fails at runtime with no icon found.
  return withXcodeProject(config, (config) => {
    const project = config.modResults
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot)

    for (const color of COLORS) {
      for (const { scale } of IOS_SIZES) {
        const suffix = scale === 1 ? '' : `@${scale}x`
        const filepath = `${projectName}/AlternateIcons/${iosIconName(color)}${suffix}.png`
        if (project.hasFile(filepath)) continue
        IOSConfig.XcodeUtils.addResourceFileToGroup({
          filepath,
          groupName: projectName,
          project,
          isBuildFile: true,
          verbose: false
        })
      }
    }
    return config
  })
}

function withAndroidAlternateIcons (config) {
  return withDangerousMod(config, ['android', (config) => {
    const projectRoot = config.modRequest.projectRoot
    const resRoot = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res')

    for (const color of COLORS) {
      const source = path.join(projectRoot, 'assets/app-icons/android', `background-${color}.png`)
      for (const { name, size } of ANDROID_DENSITIES) {
        resize(
          source,
          path.join(resRoot, `mipmap-${name}`, `ic_launcher_background_${color}.png`),
          size
        )
      }

      // An adaptive icon is three layers referenced by name, so each colour is
      // one small XML over the foreground prebuild already produced.
      const adaptive = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
        `  <background android:drawable="@mipmap/ic_launcher_background_${color}"/>`,
        '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
        '  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>',
        '</adaptive-icon>',
        ''
      ].join('\n')

      for (const folder of ['mipmap-anydpi-v26', 'mipmap-anydpi']) {
        const target = path.join(resRoot, folder)
        if (!fs.existsSync(target)) continue
        fs.writeFileSync(path.join(target, `ic_launcher_${color}.xml`), adaptive)
      }
    }
    return config
  }])
}

function withAndroidAliases (config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults)
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults)
    // Every alias needs the launcher intent, or switching to one hides the app
    // from the launcher entirely and the only way back is a reinstall.
    const launcher = (activity['intent-filter'] || []).filter((filter) => (
      (filter.category || []).some((category) => (
        category.$['android:name'] === 'android.intent.category.LAUNCHER'
      ))
    ))

    application['activity-alias'] = COLORS.map((color) => ({
      $: {
        'android:name': aliasName(color),
        'android:enabled': 'false',
        'android:exported': 'true',
        'android:icon': `@mipmap/ic_launcher_${color}`,
        'android:roundIcon': `@mipmap/ic_launcher_${color}`,
        'android:targetActivity': '.MainActivity'
      },
      'intent-filter': JSON.parse(JSON.stringify(launcher))
    }))

    return config
  })
}

module.exports.COLORS = COLORS
module.exports.addAppIconPackage = addAppIconPackage
module.exports.aliasName = aliasName
module.exports.iosIconName = iosIconName
