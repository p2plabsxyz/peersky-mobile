const {
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication
} = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const PACKAGE_REGISTRATION = 'add(BrowserDownloadsPackage())'
const SIMPLE_MAGIC_DEPENDENCY =
  'implementation("com.j256.simplemagic:simplemagic:1.17")'
const JUNIT_DEPENDENCY = 'testImplementation("junit:junit:4.13.2")'
const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')

module.exports = function withBrowserDownloads (config) {
  config = withAppBuildGradle(config, (androidConfig) => {
    androidConfig.modResults.contents = addSimpleMagicDependency(
      androidConfig.modResults.contents
    )
    return androidConfig
  })

  config = withMainApplication(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'kt') {
      throw new Error('Browser downloads require a Kotlin MainApplication.')
    }

    androidConfig.modResults.contents = addPackageRegistration(androidConfig.modResults.contents)

    return androidConfig
  })

  return withDangerousMod(config, ['android', async (androidConfig) => {
    const packageName = androidConfig.android?.package
    if (!packageName) throw new Error('Android package name is required for browser downloads.')

    const sourceDirectory = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app/src/main/java',
      ...packageName.split('.')
    )

    fs.mkdirSync(sourceDirectory, { recursive: true })
    writeAndroidSource(
      sourceDirectory,
      'BrowserDownloadsModule.kt',
      createDownloadsModule(packageName)
    )
    writeAndroidSource(
      sourceDirectory,
      'BrowserDownloadsPackage.kt',
      createDownloadsPackage(packageName)
    )
    writeAndroidSource(
      sourceDirectory,
      'PeerSkyWebViewManager.kt',
      createWebViewManager(packageName)
    )
    const testDirectory = path.join(
      androidConfig.modRequest.platformProjectRoot,
      'app/src/test/java',
      ...packageName.split('.')
    )
    fs.mkdirSync(testDirectory, { recursive: true })
    writeAndroidSource(
      testDirectory,
      'BrowserDownloadsModuleTest.kt',
      createDownloadsModuleTest(packageName)
    )

    return androidConfig
  }])
}

function addSimpleMagicDependency (contents) {
  const marker = 'dependencies {'
  if (!contents.includes(marker)) {
    throw new Error('Unable to add the browser download MIME detector.')
  }

  return [SIMPLE_MAGIC_DEPENDENCY, JUNIT_DEPENDENCY].reduce(
    (result, dependency) => result.includes(dependency)
      ? result
      : result.replace(marker, `${marker}\n    ${dependency}`),
    contents
  )
}

function addPackageRegistration (contents) {
  if (contents.includes(PACKAGE_REGISTRATION)) return contents

  const marker = 'PackageList(this).packages.apply {'
  if (!contents.includes(marker)) {
    throw new Error('Unable to register browser downloads in MainApplication.')
  }

  return contents.replace(
    marker,
    `${marker}\n          ${PACKAGE_REGISTRATION}`
  )
}

function createDownloadsModule (packageName) {
  return readAndroidTemplate('BrowserDownloadsModule.kt.template', packageName)
}

function createDownloadsPackage (packageName) {
  return readAndroidTemplate('BrowserDownloadsPackage.kt.template', packageName)
}

function createWebViewManager (packageName) {
  return readAndroidTemplate('PeerSkyWebViewManager.kt.template', packageName)
}

function createDownloadsModuleTest (packageName) {
  return readAndroidTemplate('BrowserDownloadsModuleTest.kt.template', packageName)
}

function readAndroidTemplate (filename, packageName) {
  return fs.readFileSync(path.join(TEMPLATE_DIRECTORY, filename), 'utf8')
    .replaceAll('__PACKAGE_NAME__', packageName)
}

function writeAndroidSource (directory, filename, contents) {
  fs.writeFileSync(path.join(directory, filename), contents)
}

module.exports.createDownloadsModule = createDownloadsModule
module.exports.createDownloadsPackage = createDownloadsPackage
module.exports.createWebViewManager = createWebViewManager
module.exports.createDownloadsModuleTest = createDownloadsModuleTest
module.exports.addPackageRegistration = addPackageRegistration
module.exports.addSimpleMagicDependency = addSimpleMagicDependency
