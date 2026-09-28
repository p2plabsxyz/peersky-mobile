// iOS builds the share sheet header from the item it is handed. A bare string
// gives it nothing to draw and a hyper:// link gives it nothing it can fetch,
// so it falls back to a blank page glyph. These pin the parts that stop that.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'

const objc = await readFile(new URL('../../plugins/templates/PeerSkyShareModule.m.template', import.meta.url), 'utf8')
const plugin = await readFile(new URL('../../plugins/with-peersky-share.js', import.meta.url), 'utf8')
const wrapper = await readFile(new URL('../../app/share.ts', import.meta.url), 'utf8')
const appJson = JSON.parse(await readFile(new URL('../../app.json', import.meta.url), 'utf8'))

test('the sheet is given an icon instead of being left to guess', () => {
  // UIActivityItemSource is the only hook for this; React Native's own Share
  // never reaches it.
  assert.match(objc, /<UIActivityItemSource>/)
  assert.match(objc, /activityViewControllerLinkMetadata:/)
  assert.match(objc, /metadata\.iconProvider = \[\[NSItemProvider alloc\] initWithObject:icon\]/)
  // The icon is read from the bundle, so it follows whatever icon ships.
  assert.match(objc, /CFBundlePrimaryIcon/)
  // Handed over at 60pt it gets padded into the sheet's square, which reads
  // as a white margin around the logo. Redrawn larger, it fills.
  assert.match(objc, /CGSizeMake\(180, 180\)/)
  assert.match(objc, /drawInRect:CGRectMake\(0, 0, size\.width, size\.height\)/)
})

test('the sheet is not asked to fetch a link it cannot reach', () => {
  // Setting originalURL makes iOS try to load the page, and the blank glyph
  // is what shows while that fails on a peer-to-peer scheme.
  assert.doesNotMatch(objc, /metadata\.originalURL/)
})

test('presenting cannot crash an iPad or a backgrounded scene', () => {
  // An iPad refuses to present an activity sheet with no anchor.
  assert.match(objc, /popoverPresentationController/)
  assert.match(objc, /popover\.sourceView = presenter\.view/)
  // Picking a window means picking the active one, not the first one.
  assert.match(objc, /UISceneActivationStateForegroundActive/)
  assert.match(objc, /while \(controller\.presentedViewController\)/)
  // UIKit work belongs on the main queue.
  assert.match(objc, /dispatch_async\(dispatch_get_main_queue\(\)/)
})

test('the module reaches the Xcode project', () => {
  assert.match(plugin, /addBuildSourceFileToGroup/)
  assert.match(plugin, /PeerSkyShareModule\.m/)
  assert.ok(
    appJson.expo.plugins.includes('./plugins/with-peersky-share'),
    'plugin is not registered in app.json'
  )
})

test('a build without the module still shares the right link', () => {
  // The native module only exists after a rebuild, and Android never has it.
  assert.match(wrapper, /Platform\.OS === 'ios' && PeerSkyShare != null/)
  assert.match(wrapper, /await Share\.share\(title \? \{ message, title \} : \{ message \}\)/)
  // A sheet that fails to present must not swallow the share entirely.
  assert.match(wrapper, /catch \{[\s\S]*?\n {2}\}\n\n {2}await Share\.share/)
})

test('nothing shares around the wrapper', async () => {
  // A call site left on Share.share is one that keeps the blank glyph.
  const files = []
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) await walk(next)
      else if (/\.tsx?$/.test(entry.name) && entry.name !== 'share.ts') files.push(next)
    }
  }
  await walk(new URL('../../app/', import.meta.url))

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /\bShare\.share\(/, `${file.pathname} still calls Share.share`)
  }
})
