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
  // History goes with it, as DuckDuckGo's Fire Button and Firefox Focus do,
  // and the question says so before anything burns.
  assert.match(burn, /const historyCleared = clearBrowserHistory\(\)/)
  assert.match(confirm, /'Burn tabs, history and cached data\?'/)
  assert.match(confirm, /deletes your browsing and search history and cached website files\. Bookmarks and downloads stay\./)
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

// The fire faded out where it stood. Now it comes up from the bottom and goes
// on up and off the top, with the bird, and the screen comes back behind it.
test('the fire comes up from the bottom and leaves off the top', async () => {
  const animation = await read('app/BurnAnimation.tsx')
  assert.match(animation, /const leave = -\(fireTop \+ bodyHeight\)/)
  assert.match(animation, /translateY: travel\.interpolate\(\{ inputRange: \[0, 1, 2\], outputRange: \[height, 0, leave\] \}\)/)
  assert.match(animation, /translateY: travel\.interpolate\(\{ inputRange: \[0, 1, 2\], outputRange: \[0, 0, leave\] \}\)/)
  assert.match(animation, /Animated\.timing\(travel, \{ duration: LEAVE_MS, easing: Easing\.in\(Easing\.quad\), toValue: 2/)
  assert.doesNotMatch(animation, /opacity: fade/)
  // Its tail thins to nothing, so there is no hard edge as the screen returns.
  assert.match(animation, /<Stop offset='1' stopColor='#4a0805' stopOpacity=\{0\} \/>/)
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

// The flames were two jagged paths stretched to the screen: they read as big
// triangles. Each flame is now its own curved shape at a fixed size, repeated
// across wider screens rather than stretched, and flickering on its own beat.
test('the fire is made of flames, not stretched triangles', async () => {
  const animation = await read('app/BurnAnimation.tsx')
  for (const name of ['FLAME', 'FLAME_HEART']) {
    const path = animation.match(new RegExp(`const ${name} = '([^']+)'`))?.[1] || ''
    assert.match(path, /^M[\d. ]+( C[\d. ]+)+ Z$/, `${name} is made of curves`)
  }
  assert.match(animation, /const TILE_WIDTH = 393/)
  assert.match(animation, /Math\.ceil\(width \/ TILE_WIDTH\)/)
  assert.doesNotMatch(animation, /<Svg[^>]*preserveAspectRatio='none'[^>]*viewBox='0 0 100 140'/)
  assert.match(animation, /const beats = useRef\(\[0, 1, 2\]\.map/)
  assert.match(animation, /transformOrigin: 'bottom'/)
})
