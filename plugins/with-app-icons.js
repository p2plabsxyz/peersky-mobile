const fs = require('node:fs')
const path = require('node:path')
const {
  AndroidConfig,
  IOSConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withXcodeProject
} = require('@expo/config-plugins')

const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')
const IOS_GROUP_NAME = 'PeerSkyAppIcon'
const PACKAGE_REGISTRATION = 'add(PeerSkyAppIconPackage())'

// Kept in step with app/app-logo-colors.mjs: the picker offers these ids and
// the launcher has to have an icon under each one.
const COLORS = ['cyan', 'green', 'violet', 'yellow', 'light', 'dark']

// Every alternate is its own icon set in the asset catalog, not a loose file
// in the bundle. Loose files are a single image each, with no dark or tinted
// variant, so picking a colour used to switch the system appearance icons off
// altogether. An icon set carries all three.
const IOS_APPEARANCES = [
  { file: null, name: '' },
  { file: 'appearance-dark.png', name: 'dark' },
  { file: 'appearance-tinted.png', name: 'tinted' }
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

// The same image tool Expo's own icon generation uses. It prefers sharp and
// falls back to jimp, so this works on a Linux runner as well as a Mac; sips
// does not exist off macOS, which is what broke CI.
async function resize (projectRoot, source, destination, size) {
  const { generateImageAsync } = require('@expo/image-utils')
  const { source: resized } = await generateImageAsync(
    { projectRoot, cacheType: 'peersky-app-icons' },
    {
      src: source,
      width: size,
      height: size,
      resizeMode: 'contain',
      backgroundColor: 'transparent'
    }
  )

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, resized)
}

function withIosAlternateIcons (config) {
  // Xcode only compiles icon sets it is told about by name, and only ships the
  // ones beyond the primary when asked.
  config = withXcodeProject(config, (config) => {
    const project = config.modResults
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project,
      projectName: IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot)
    })

    for (const { buildSettings } of Object.values(project.pbxXCBuildConfigurationSection())) {
      if (!buildSettings || buildSettings.PRODUCT_NAME === undefined) continue
      // A list, not a space joined string: the pbxproj parser reads a bare
      // quote in a scalar as the start of a new token and refuses the file.
      buildSettings.ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES = COLORS
        .map((color) => `"${iosIconName(color)}"`)
      buildSettings.ASSETCATALOG_COMPILER_INCLUDE_ALL_APPICON_ASSETS = 'YES'
    }

    if (!target) throw new Error('Alternate app icons need an application target.')
    return config
  })

  return withDangerousMod(config, ['ios', async (config) => {
    const projectRoot = config.modRequest.projectRoot
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot)
    const catalog = path.join(
      config.modRequest.platformProjectRoot,
      projectName,
      'Images.xcassets'
    )

    for (const color of COLORS) {
      const set = path.join(catalog, `${iosIconName(color)}.appiconset`)
      fs.mkdirSync(set, { recursive: true })

      const images = []
      for (const appearance of IOS_APPEARANCES) {
        // The colour only changes the light icon. Dark is the same dark icon
        // whichever colour is chosen, and tinted is greyscale by definition.
        const source = appearance.file
          ? path.join(projectRoot, 'assets/app-icons/ios', appearance.file)
          : path.join(projectRoot, 'assets/app-icons/ios', `${color}.png`)
        const filename = appearance.name
          ? `icon-${appearance.name}.png`
          : 'icon.png'

        await resize(projectRoot, source, path.join(set, filename), 1024)
        images.push({
          filename,
          idiom: 'universal',
          platform: 'ios',
          size: '1024x1024',
          ...(appearance.name
            ? { appearances: [{ appearance: 'luminosity', value: appearance.name }] }
            : {})
        })
      }

      fs.writeFileSync(
        path.join(set, 'Contents.json'),
        `${JSON.stringify({ images, info: { version: 1, author: 'peersky' } }, null, 2)}\n`
      )
    }

    return config
  }])
}

function withAndroidAlternateIcons (config) {
  return withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.projectRoot
    const resRoot = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res')

    for (const color of COLORS) {
      const source = path.join(projectRoot, 'assets/app-icons/android', `background-${color}.png`)
      for (const { name, size } of ANDROID_DENSITIES) {
        await resize(
          projectRoot,
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

    const isLauncher = (filter) => (filter.category || []).some((category) => (
      category.$['android:name'] === 'android.intent.category.LAUNCHER'
    ))
    const launcher = (activity['intent-filter'] || []).filter(isLauncher)

    // The launcher entry moves off the activity and onto the aliases, all of
    // it. The activity itself stays enabled and keeps every other filter, so
    // deep links and anything that starts it by class still work.
    //
    // The alternative, leaving the entry here and disabling the activity when
    // an alias is on, breaks starting it by name: the dev launcher, and
    // anything else holding an explicit component, gets "unable to find
    // explicit activity class".
    activity['intent-filter'] = (activity['intent-filter'] || []).filter(
      (filter) => !isLauncher(filter)
    )

    // One is on from the start, or a fresh install has no icon at all.
    application['activity-alias'] = COLORS.map((color) => ({
      $: {
        'android:name': aliasName(color),
        'android:enabled': color === COLORS[0] ? 'true' : 'false',
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
