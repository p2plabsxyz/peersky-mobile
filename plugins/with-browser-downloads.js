const {
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
  withXcodeProject,
  IOSConfig
} = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const PACKAGE_REGISTRATION = 'add(BrowserDownloadsPackage())'
const CONTENT_BLOCKING_PACKAGE_REGISTRATION = 'add(BrowserContentBlockingPackage())'
const SIMPLE_MAGIC_DEPENDENCY =
  'implementation("com.j256.simplemagic:simplemagic:1.17")'
const JUNIT_DEPENDENCY = 'testImplementation("junit:junit:4.13.2")'
const CONTENT_BLOCKING_BUILD_MARKER = '// PeerSky content-blocking native build'
const TEMPLATE_DIRECTORY = path.join(__dirname, 'templates')

module.exports = function withBrowserDownloads (config) {
  config = withAppBuildGradle(config, (androidConfig) => {
    androidConfig.modResults.contents = addSimpleMagicDependency(
      androidConfig.modResults.contents
    )
    androidConfig.modResults.contents = addContentBlockingBuild(
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

  config = withDangerousMod(config, ['android', async (androidConfig) => {
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
    writeAndroidSource(
      sourceDirectory,
      'BrowserContentBlockingModule.kt',
      createContentBlockingModule(packageName)
    )
    writeAndroidSource(
      sourceDirectory,
      'BrowserContentBlockingPackage.kt',
      createContentBlockingPackage(packageName)
    )
    writeAndroidSource(
      sourceDirectory,
      'PeerSkyAdBlockEngine.kt',
      createAdBlockEngine(packageName)
    )
    writeAndroidSource(
      sourceDirectory,
      'PeerSkyWebViewClient.kt',
      createWebViewClient(packageName)
    )
    writeContentBlockingRustProject(
      androidConfig.modRequest.platformProjectRoot,
      packageName
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
    writeAndroidSource(
      testDirectory,
      'PeerSkyWebViewClientTest.kt',
      createWebViewClientTest(packageName)
    )

    return androidConfig
  }])

  config = withDangerousMod(config, ['ios', async (iosConfig) => {
    const sourceDirectory = path.join(
      iosConfig.modRequest.platformProjectRoot,
      'PeerSkyContentBlocking'
    )
    fs.mkdirSync(sourceDirectory, { recursive: true })
    for (const filename of IOS_CONTENT_BLOCKING_SOURCES) {
      fs.copyFileSync(
        path.join(TEMPLATE_DIRECTORY, `${filename}.template`),
        path.join(sourceDirectory, filename)
      )
    }
    return iosConfig
  }])

  return withXcodeProject(config, (iosConfig) => {
    const project = iosConfig.modResults
    const groupName = 'PeerSkyContentBlocking'
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, groupName)
    for (const filename of IOS_CONTENT_BLOCKING_SOURCES) {
      const file = {
        filepath: path.join(groupName, filename),
        groupName,
        project
      }
      if (filename.endsWith('.m')) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup(file)
      } else {
        IOSConfig.XcodeUtils.addFileToGroupAndLink({
          ...file,
          addFileToProject: ({ project, file }) => {
            project.addToPbxFileReferenceSection(file)
          }
        })
      }
    }
    return iosConfig
  })
}

const IOS_CONTENT_BLOCKING_SOURCES = Object.freeze([
  'PeerSkyContentBlocker.h',
  'PeerSkyContentBlocker.m',
  'BrowserContentBlockingModule.m',
  'PeerSkyWebViewManager.m'
])

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
  const marker = 'PackageList(this).packages.apply {'
  if (!contents.includes(marker)) {
    throw new Error('Unable to register browser downloads in MainApplication.')
  }

  return [PACKAGE_REGISTRATION, CONTENT_BLOCKING_PACKAGE_REGISTRATION].reduce(
    (result, registration) => result.includes(registration)
      ? result
      : result.replace(marker, `${marker}\n          ${registration}`),
    contents
  )
}

function addContentBlockingBuild (contents) {
  const markerIndex = contents.indexOf(CONTENT_BLOCKING_BUILD_MARKER)
  const baseContents = markerIndex >= 0
    ? contents.slice(0, markerIndex).trimEnd()
    : contents.trimEnd()

  return [
    baseContents,
    '',
    CONTENT_BLOCKING_BUILD_MARKER,
    'def peerSkyCargoExecutable = System.getProperty(\'os.name\').toLowerCase().contains(\'windows\') ? \'cargo.exe\' : \'cargo\'',
    'def peerSkyCargoHome = new File(System.getProperty(\'user.home\'), \'.cargo/bin/\' + peerSkyCargoExecutable)',
    'def peerSkyCargo = System.getenv(\'CARGO\') ?: (peerSkyCargoHome.exists() ? peerSkyCargoHome.absolutePath : peerSkyCargoExecutable)',
    'def peerSkyAdblockSource = file(\'src/main/rust/content-blocker\')',
    'def peerSkyAdblockOutput = file(\'src/main/jniLibs\')',
    '',
    'def peerSkyAdblockLibraries = [',
    '    \'armeabi-v7a\', \'arm64-v8a\', \'x86\', \'x86_64\'',
    '].collect { file(peerSkyAdblockOutput.toString() + \'/\' + it + \'/libpeersky_adblock.so\') }',
    '',
    'tasks.register(\'buildPeerSkyContentBlocker\', Exec) {',
    '    inputs.files(fileTree(peerSkyAdblockSource) { exclude \'target/**\' })',
    '    outputs.files(peerSkyAdblockLibraries)',
    '    workingDir peerSkyAdblockSource',
    '    environment \'ANDROID_NDK_HOME\', android.ndkDirectory.absolutePath',
    '    commandLine peerSkyCargo, \'ndk\',',
    '        \'-t\', \'armeabi-v7a\', \'-t\', \'arm64-v8a\',',
    '        \'-t\', \'x86\', \'-t\', \'x86_64\',',
    '        \'-o\', peerSkyAdblockOutput.absolutePath,',
    '        \'build\', \'--release\', \'--locked\'',
    '}',
    '',
    'tasks.named(\'preBuild\').configure {',
    '    dependsOn tasks.named(\'buildPeerSkyContentBlocker\')',
    '}',
    ''
  ].join('\n')
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

function createContentBlockingModule (packageName) {
  return readAndroidTemplate('BrowserContentBlockingModule.kt.template', packageName)
}

function createContentBlockingPackage (packageName) {
  return readAndroidTemplate('BrowserContentBlockingPackage.kt.template', packageName)
}

function createAdBlockEngine (packageName) {
  return readAndroidTemplate('PeerSkyAdBlockEngine.kt.template', packageName)
}

function createWebViewClient (packageName) {
  return readAndroidTemplate('PeerSkyWebViewClient.kt.template', packageName)
}

function createDownloadsModuleTest (packageName) {
  return readAndroidTemplate('BrowserDownloadsModuleTest.kt.template', packageName)
}

function createWebViewClientTest (packageName) {
  return readAndroidTemplate('PeerSkyWebViewClientTest.kt.template', packageName)
}

function readAndroidTemplate (filename, packageName) {
  return fs.readFileSync(path.join(TEMPLATE_DIRECTORY, filename), 'utf8')
    .replaceAll('__PACKAGE_NAME__', packageName)
}

function writeAndroidSource (directory, filename, contents) {
  fs.writeFileSync(path.join(directory, filename), contents)
}

function writeContentBlockingRustProject (androidRoot, packageName) {
  const rustDirectory = path.join(
    androidRoot,
    'app/src/main/rust/content-blocker'
  )
  fs.mkdirSync(path.join(rustDirectory, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(rustDirectory, 'Cargo.toml'),
    fs.readFileSync(
      path.join(TEMPLATE_DIRECTORY, 'content-blocker.Cargo.toml.template'),
      'utf8'
    )
  )
  fs.copyFileSync(
    path.join(TEMPLATE_DIRECTORY, 'content-blocker.Cargo.lock.template'),
    path.join(rustDirectory, 'Cargo.lock')
  )
  fs.writeFileSync(
    path.join(rustDirectory, 'src/lib.rs'),
    readAndroidTemplate('content-blocker.lib.rs.template', packageName)
      .replaceAll('__PACKAGE_PATH__', packageName.replaceAll('.', '/'))
  )
}

module.exports.createDownloadsModule = createDownloadsModule
module.exports.createDownloadsPackage = createDownloadsPackage
module.exports.createWebViewManager = createWebViewManager
module.exports.createDownloadsModuleTest = createDownloadsModuleTest
module.exports.createWebViewClientTest = createWebViewClientTest
module.exports.createContentBlockingModule = createContentBlockingModule
module.exports.createContentBlockingPackage = createContentBlockingPackage
module.exports.createAdBlockEngine = createAdBlockEngine
module.exports.createWebViewClient = createWebViewClient
module.exports.addPackageRegistration = addPackageRegistration
module.exports.addSimpleMagicDependency = addSimpleMagicDependency
module.exports.addContentBlockingBuild = addContentBlockingBuild
module.exports.IOS_CONTENT_BLOCKING_SOURCES = IOS_CONTENT_BLOCKING_SOURCES
