import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import { createRequire } from 'node:module'
import { APP_LOGO_COLORS } from '../../app/app-logo-colors.mjs'

const require = createRequire(import.meta.url)
const plugin = require('../../plugins/with-app-icons')
const appJson = require('../../app.json')

describe('alternate app icons', () => {
  test('every colour the picker offers has a launcher icon behind it', () => {
    // A colour with no icon is a switch that silently does nothing.
    assert.deepEqual(plugin.COLORS, APP_LOGO_COLORS.map((color) => color.id))
  })

  test('each colour has the files both platforms need', async () => {
    const { access } = await import('node:fs/promises')

    for (const color of plugin.COLORS) {
      await access(new URL(`../../assets/app-icons/ios/${color}.png`, import.meta.url))
      await access(new URL(`../../assets/app-icons/android/background-${color}.png`, import.meta.url))
    }
  })

  test('the iOS appearance variants ship with the primary icon', () => {
    // iOS 18 asks for a dark and a tinted icon; without them the system
    // darkens the light one itself and it looks wrong.
    assert.deepEqual(appJson.expo.ios.icon, {
      light: './assets/app-icons/ios/cyan.png',
      dark: './assets/app-icons/ios/appearance-dark.png',
      tinted: './assets/app-icons/ios/appearance-tinted.png'
    })
    assert.equal(
      appJson.expo.android.adaptiveIcon.monochromeImage,
      './assets/app-icons/android/monochrome.png'
    )
  })

  test('the activity is never the thing being switched off', async () => {
    const module = await readFile(
      new URL('../../plugins/templates/PeerSkyAppIconModule.kt.template', import.meta.url),
      'utf8'
    )

    // Disabling MainActivity to hide its launcher entry also stops anything
    // starting the app by class name, and the dev launcher does exactly that:
    // "unable to find explicit activity class". Every colour is an alias
    // instead, and the activity keeps out of it.
    // setIcon must never touch it. The only place that names the bare
    // activity is the repair below, which only ever enables it.
    const setIcon = module.slice(module.indexOf('fun setIcon'))
    assert.doesNotMatch(setIcon, /MainActivity"/)
    assert.doesNotMatch(setIcon, /val main\b/)
    assert.match(module, /val target = name\?\.takeIf \{ ALIASES\.contains\(it\) \} \?: DEFAULT_ALIAS/)
    // Enabled first, disabled after: a gap with nothing enabled loses the app.
    const enableAt = setIcon.indexOf('COMPONENT_ENABLED_STATE_ENABLED')
    const disableAt = setIcon.indexOf('COMPONENT_ENABLED_STATE_DISABLED')
    assert.ok(enableAt > 0 && disableAt > enableAt)
  })

  test('the launcher entry belongs to the aliases, and one is always on', async () => {
    const source = await readFile(new URL('../../plugins/with-app-icons.js', import.meta.url), 'utf8')

    // It moves off the activity, so the app is never listed twice, and the
    // activity keeps every other filter so deep links still reach it.
    assert.match(source, /activity\['intent-filter'\] = \(activity\['intent-filter'\] \|\| \[\]\)\.filter\(\s*\n?\s*\(filter\) => !isLauncher\(filter\)/)
    assert.match(source, /'android:enabled': color === COLORS\[0\] \? 'true' : 'false'/)
  })
})

describe('adaptive icon layers', () => {
  test('the artwork fits the mask and sits in the middle of it', async () => {
    const { readFile } = await import('node:fs/promises')
    const { PNG } = await import('pngjs')

    // Android cuts a shape out of the 108dp canvas and only guarantees a 66dp
    // circle in the middle survives. Artwork wider than that, or off centre,
    // loses whatever meets the edge: the bird was losing its beak and legs.
    const safeRadius = 33 / 108

    for (const layer of ['foreground', 'monochrome']) {
      const image = PNG.sync.read(
        await readFile(new URL(`../../assets/app-icons/android/${layer}.png`, import.meta.url))
      )
      const middle = image.width / 2
      let weight = 0
      let sumX = 0
      let sumY = 0
      let radius = 0
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const alpha = image.data[(y * image.width + x) * 4 + 3]
          if (alpha <= 8) continue
          weight += alpha
          sumX += (x + 0.5) * alpha
          sumY += (y + 0.5) * alpha
          radius = Math.max(radius, Math.hypot(x + 0.5 - middle, y + 0.5 - middle))
        }
      }

      // Measured from the middle of the canvas, where the mask is.
      assert.ok(
        radius / image.width <= safeRadius,
        `${layer} reaches ${(radius / image.width * 100).toFixed(1)}% of the canvas`
      )
      // Centred on its weight. Centred on its box, the thin legs below the
      // body pulled the box down and the bird sat high in the circle.
      assert.ok(Math.abs(sumX / weight - middle) < 2, `${layer} is off centre horizontally`)
      assert.ok(Math.abs(sumY / weight - middle) < 2, `${layer} is off centre vertically`)
    }
  })

  test('the icons are built with something that exists off a Mac', async () => {
    const source = await readFile(new URL('../../plugins/with-app-icons.js', import.meta.url), 'utf8')

    // sips is macOS only, so prebuild on a Linux runner died with
    // "spawnSync sips ENOENT" before it reached the Android icons. This is
    // the tool Expo's own icon generation uses, sharp where it is available
    // and jimp everywhere else.
    assert.doesNotMatch(source, /sips'|"sips"|execFileSync|spawnSync/)
    assert.match(source, /require\('@expo\/image-utils'\)/)
    assert.match(source, /generateImageAsync\(/)
  })

  test('a device left with MainActivity disabled repairs itself', async () => {
    const module = await readFile(
      new URL('../../plugins/templates/PeerSkyAppIconModule.kt.template', import.meta.url),
      'utf8'
    )

    // Component state belongs to the package, not the APK, so it survives
    // reinstalling, and adb cannot clear it because only the app may change
    // its own components. The app is the only thing that can undo it.
    const repair = module.slice(module.indexOf('override fun initialize'), module.indexOf('fun aliasFor'))
    assert.match(repair, /COMPONENT_ENABLED_STATE_DISABLED/)
    assert.match(repair, /COMPONENT_ENABLED_STATE_ENABLED/)
    // And it must never stop the app starting.
    assert.match(repair, /catch \(error: Exception\)/)
  })

  // The badge library keeps the launcher entry it first counted on, which a
  // switch turns off, so the PeerChat count vanished until a restart.
  test('the unread count moves to the new icon', async () => {
    const module = await readFile(
      new URL('../../plugins/templates/PeerSkyAppIconModule.kt.template', import.meta.url),
      'utf8'
    )
    const setIcon = module.slice(module.indexOf('fun setIcon'), module.indexOf('private fun moveBadgeToCurrentIcon'))
    assert.match(setIcon, /DONT_KILL_APP\s+\)\s+\}\s+moveBadgeToCurrentIcon\(\)\s+promise\.resolve\(true\)/)

    const move = module.slice(module.indexOf('private fun moveBadgeToCurrentIcon'), module.indexOf('companion object'))
    assert.match(move, /listOf\("sShortcutBadger", "sComponentName"\)/)
    assert.match(move, /Class\.forName\("expo\.modules\.notifications\.badge\.BadgeHelper"\)/)
    assert.match(move, /if \(count > 0\) \{/)
    // A change in either library must not fail the switch itself.
    assert.match(move, /catch \(error: Exception\)/)

    // Release builds keep class and field names, which this looks up by name.
    const gradle = await readFile(new URL('../../app.json', import.meta.url), 'utf8')
    assert.doesNotMatch(gradle, /enableMinifyInReleaseBuilds|enableProguardInReleaseBuilds/)
  })
})
