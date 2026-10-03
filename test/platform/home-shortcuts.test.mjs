import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'
import { gunzipSync } from 'node:zlib'

import { HOME_SHORTCUTS, parseHomeShortcutUrl } from '../../app/home-shortcuts.mjs'

const require = createRequire(import.meta.url)
const plugin = require('../../plugins/with-home-shortcuts')
const appJson = require('../../app.json')
const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

// The AppDelegate a prebuild starts from, out of the Expo template installed
// here, so a new template that the plugin no longer fits fails here first.
async function readTemplateAppDelegate () {
  const archive = gunzipSync(await readFile(new URL('../../node_modules/expo/template.tgz', import.meta.url)))
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512)
    const name = header.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '')
    if (!name) break
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0[\s\S]*$/, '').trim(), 8) || 0
    const body = offset + 512
    if (name.endsWith('/ios/HelloWorld/AppDelegate.swift')) {
      return archive.subarray(body, body + size).toString('utf8')
    }
    offset = body + Math.ceil(size / 512) * 512
  }
  throw new Error('The Expo template has no AppDelegate.swift')
}

function runMod (mod, modResults) {
  return mod({
    modResults,
    modRequest: { platform: 'ios', projectRoot: process.cwd(), platformProjectRoot: 'ios', introspect: true }
  })
}

describe('quick actions on the app icon', () => {
  test('reads each one from its link, and nothing else', () => {
    for (const name of HOME_SHORTCUTS) {
      assert.equal(parseHomeShortcutUrl(`peersky://shortcut/${name}`), name)
    }
    assert.equal(parseHomeShortcutUrl(' PEERSKY://shortcut/New-Tab/ '), 'new-tab')
    for (const url of [
      'peersky://shortcut/',
      'peersky://shortcut/close-all',
      'peersky://shortcut/new-tab?url=https://example.com',
      'https://shortcut/new-tab',
      'peersky://p2p/peerchat/',
      null,
      undefined
    ]) {
      assert.equal(parseHomeShortcutUrl(url), null, String(url))
    }
  })

  test('are on the icon, at most the four iOS shows', async () => {
    assert.ok(appJson.expo.plugins.includes('./plugins/with-home-shortcuts'))
    assert.ok(HOME_SHORTCUTS.length <= 4)

    const config = plugin({ name: 'PeerSky', slug: 'peersky' })
    const { modResults } = await runMod(config.mods.ios.infoPlist, {})
    assert.deepEqual(
      modResults.UIApplicationShortcutItems.map((item) => item.UIApplicationShortcutItemType),
      HOME_SHORTCUTS.map((name) => `peersky.shortcut.${name}`)
    )
    for (const item of modResults.UIApplicationShortcutItems) {
      assert.ok(item.UIApplicationShortcutItemTitle)
      assert.ok(item.UIApplicationShortcutItemIconSymbolName)
    }
  })

  test('reach the app whether it was running or not, and once', async () => {
    const template = await readTemplateAppDelegate()
    const config = plugin({ name: 'PeerSky', slug: 'peersky' })
    const { modResults } = await runMod(config.mods.ios.appDelegate, { language: 'swift', contents: template })
    const swift = modResults.contents

    // Not running: the link becomes the launch URL React Native reads, and
    // iOS is told not to send the action again.
    assert.match(swift, /reactLaunchOptions\[\.url\] = launchShortcutURL/)
    assert.match(swift, /launchOptions: reactLaunchOptions\)/)
    assert.match(swift, /guard let launchShortcutURL else \{ return finished \}/)
    assert.match(swift, /return false\n {2}\}/)
    // A development build holds it until a bundle loads, and hears of it only
    // as an opened link. Through super alone, so React Native gets it once.
    assert.match(swift, /_ = super\.application\(application, open: launchShortcutURL, options: \[:\]\)/)
    // Running: straight to React Native.
    assert.match(swift, /performActionFor shortcutItem: UIApplicationShortcutItem/)
    assert.match(swift, /completionHandler\(RCTLinkingManager\.application\(application, open: url, options: \[:\]\)\)/)
    assert.match(swift, /URL\(string: "peersky:\/\/shortcut\/" \+ type\.dropFirst\(peerSkyShortcutPrefix\.count\)\)/)

    // A second prebuild on the same file changes nothing.
    assert.equal(plugin.addShortcutsToAppDelegate(swift), swift)
    assert.throws(() => plugin.addShortcutsToAppDelegate('class AppDelegate {}'), /quick actions/)
  })

  // Marked as something done in the app, a quick action that started it
  // opened the app without the tabs from last time.
  test('go on top of last time\'s tabs', () => {
    assert.match(app, /if \(parseHomeShortcutUrl\(url\)\) \{\s+setPendingHomeShortcutUrl\(url\)\s+return\s+\}/)
    assert.match(app, /if \(!browserSessionReady \|\| !pendingHomeShortcutUrl\) return/)
  })

  test('each does what it says', () => {
    assert.match(app, /shortcut === 'new-tab'\) \{\s+setBrowserSettingsVisible\(false\)\s+onBrowserNewTab\(\)/)
    assert.match(app, /shortcut === 'incognito'\) \{\s+setBrowserSettingsVisible\(false\)\s+onBrowserNewIncognitoTab\(\)/)
    assert.match(app, /shortcut === 'app-icon'\) \{[^}]*setBrowserSettingsInitialPage\('appearance'\)\s+setBrowserSettingsVisible\(true\)/)
    // A new tab loads its address as given, so "example.com" failed to load
    // until it went through the address bar's rules first.
    assert.match(app, /const target = normalizeBrowserAddress\(\s+value,/)
    assert.match(app, /if \(!createBrowserTab\(target\)\) void loadBrowserUrl\(target\)/)
  })
})
