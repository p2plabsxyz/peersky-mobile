import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// Publishing used to end in an alert. Tap Copy or Done and the link was gone,
// with nothing on screen to get it back.
test('a published note opens a sheet that can be opened again', async () => {
  const app = await read('app/index.tsx')
  const prompt = app.slice(
    app.indexOf('function promptPublishedLink'),
    app.indexOf('async function handleP2pmdBridgeRequest')
  )

  assert.doesNotMatch(prompt, /Alert\.alert/)
  assert.match(prompt, /setP2pmdPublishSheet\(/)

  // The row in the note bar reopens the same sheet rather than copying
  // silently, and it says Share so it reads as something to press.
  const row = app.slice(app.indexOf('{p2pmdPublishUrl && ('), app.indexOf('p2pmdWorkspaceSyncStatus'))
  assert.match(row, /onPress=\{\(\) => setP2pmdPublishSheet\(p2pmdPublishedModeRef\.current\)\}/)
  assert.match(row, />Share<\/Text>/)

  const sheet = app.slice(app.indexOf('<PublishedLinkSheet'), app.indexOf('/>', app.indexOf('<PublishedLinkSheet')))
  assert.match(sheet, /message='Share it with other peers!/)
  assert.match(sheet, /url=\{p2pmdPublishUrl\}/)
})

test('the published link sheet keeps the link, and shares or copies it', async () => {
  const sheet = await read('app/PublishedLinkSheet.tsx')

  assert.match(sheet, /shareLink\(\{ title: shareTitle, message: url \}\)/)
  assert.match(sheet, /Clipboard\.setString\(url\)/)
  // Copying does not close the sheet: the link stays on screen.
  const copy = sheet.slice(sheet.indexOf('function copy ()'), sheet.indexOf('function share ()'))
  assert.doesNotMatch(copy, /onClose/)
  assert.match(sheet, /\{copied \? 'Copied' : 'Tap to copy'\}/)
})

test('a Hyperdrive upload that can be shared says so', async () => {
  const screen = await read('app/hyperdrive/HyperdriveScreen.tsx')
  const upload = screen.slice(screen.indexOf('async function uploadFile'), screen.indexOf('} catch (uploadError)'))

  // Public and private uploads get the sheet; a device-only file never leaves
  // the phone, so it keeps a plain note instead of a link to pass on.
  assert.match(upload, /if \(visibility === 'device'\) \{/)
  assert.match(upload, /setSharedUpload\(\{ item: lastItem, visibility, count: assets\.length \}\)/)
  assert.match(screen, /<PublishedLinkSheet/)
  assert.match(screen, /'Share it with other peers! Anyone with the link can open it, straight from this phone\./)
  // The old text sent people to paste an identity URL, which no longer exists.
  assert.doesNotMatch(screen, /no export path yet/)
})

test('a PeerTunes share link asks to be passed on, and stays on screen after a copy', async () => {
  const ui = await read('assets/peertunes/js/ui.js')
  const offer = ui.slice(ui.indexOf('_offerLink(link) {'), ui.indexOf('urlScreen() {'))

  assert.match(offer, /msg: "Share it with other peers!"/)
  assert.match(offer, /sub: ok \? "Send it to a friend\.\\n" \+ link/)

  // The bundled copy has to match, or the phone still shows the old text.
  const runtime = await read('backend/peertunes/peertunes-runtime.mjs')
  assert.ok(runtime.includes('Share it with other peers!'))
})
