import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PNG } from 'pngjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Burning used to happen the moment you confirmed, with nothing to show for
// it. Now the flames go up and the tabs go under their cover.
test('the tabs are burned under the flames, not before them', async () => {
  const app = await read('app/index.tsx')
  const confirm = app.slice(app.indexOf('function onBrowserBurnTabs'), app.indexOf('function burnBrowserTabs'))
  assert.match(confirm, /setBrowserTabsVisible\(false\)\s+setBrowserBurning\(true\)/)
  assert.doesNotMatch(confirm, /onBrowserResetTabs|clearBrowserWebViewData/)

  const burn = app.slice(app.indexOf('function burnBrowserTabs'), app.indexOf('function onBrowserCloseAllTabs'))
  assert.match(burn, /clearBrowserWebViewData\(webView\)/)
  assert.match(burn, /onBrowserResetTabs\(\)/)
  assert.match(app, /<BurnAnimation onBurn=\{burnBrowserTabs\} onDone=\{\(\) => setBrowserBurning\(false\)\} \/>/)
})

test('the burn happens once the flames are up, and at once with Reduce Motion', async () => {
  const animation = await read('app/BurnAnimation.tsx')
  assert.match(animation, /if \(reduceMotion\) \{\s+callbacks\.current\.onBurn\(\)\s+callbacks\.current\.onDone\(\)/)
  // Burned whether or not the animation got to finish.
  assert.match(animation, /animation\.start\(\(\{ finished \}\) => \{\s+if \(!active\) return\s+callbacks\.current\.onBurn\(\)/)
  // Opaque behind the flames, so the old tabs never show between tongues.
  assert.match(animation, /scorch: \{ backgroundColor: '#1c0703' \}/)
  assert.match(animation, /require\('\.\.\/assets\/images\/burn-bird\.png'\)/)
})

// The everyday bird, angry and on fire: same outline, so the same shape, and
// none of its blue left.
test('the burning bird is the everyday bird in flame colours', async () => {
  const bird = PNG.sync.read(await readFile(new URL('../../assets/images/burn-bird.png', import.meta.url)))
  assert.equal(bird.width, 512)
  assert.equal(bird.height, 512)

  let blue = 0
  let flame = 0
  for (let index = 0; index < bird.width * bird.height; index++) {
    const [red, green, b, alpha] = bird.data.subarray(index * 4, index * 4 + 4)
    if (alpha < 200) continue
    if (b > red + 60 && b > 120) blue++
    if (red > 200 && green > 60 && b < 90) flame++
  }
  assert.ok(blue < 50, `${blue} blue pixels left`)
  assert.ok(flame > 30000, `only ${flame} flame pixels`)

  const generator = await read('scripts/generate-burn-bird.mjs')
  assert.match(generator, /const SOURCE = new URL\('assets\/images\/logo\.png', root\)/)
})
