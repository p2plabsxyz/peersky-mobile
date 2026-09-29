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

  test('the default colour switches no alias on', async () => {
    const module = await readFile(
      new URL('../../plugins/templates/PeerSkyAppIconModule.kt.template', import.meta.url),
      'utf8'
    )

    // The activity carries the default icon and its own launcher entry, so
    // enabling an alias for it as well puts the app on the home screen twice.
    assert.match(module, /val target = name\?\.takeIf \{ it != DEFAULT_ALIAS/)
    assert.match(module, /if \(target != null\) listOf\(main\) else emptyList\(\)/)
    // Enabled first, disabled after: a gap with nothing enabled loses the app.
    const enableAt = module.indexOf('COMPONENT_ENABLED_STATE_ENABLED,\n        PackageManager.DONT_KILL_APP')
    const disableAt = module.indexOf('COMPONENT_ENABLED_STATE_DISABLED')
    assert.ok(enableAt > 0 && disableAt > enableAt)
  })

  test('the aliases keep the launcher intent they are named for', async () => {
    const source = await readFile(new URL('../../plugins/with-app-icons.js', import.meta.url), 'utf8')

    // An alias without it hides the app from the launcher, and the only way
    // back is a reinstall.
    assert.match(source, /category\.\$\['android:name'\] === 'android\.intent\.category\.LAUNCHER'/)
    assert.match(source, /'android:enabled': 'false'/)
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
      let minX = image.width
      let minY = image.height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (image.data[(y * image.width + x) * 4 + 3] <= 8) continue
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }

      const centerX = (minX + maxX + 1) / 2
      const centerY = (minY + maxY + 1) / 2
      let radius = 0
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (image.data[(y * image.width + x) * 4 + 3] <= 8) continue
          radius = Math.max(radius, Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY))
        }
      }

      assert.ok(
        radius / image.width <= safeRadius,
        `${layer} reaches ${(radius / image.width * 100).toFixed(1)}% of the canvas`
      )
      assert.ok(Math.abs(centerX - image.width / 2) < 2, `${layer} is off centre horizontally`)
      assert.ok(Math.abs(centerY - image.height / 2) < 2, `${layer} is off centre vertically`)
    }
  })
})
