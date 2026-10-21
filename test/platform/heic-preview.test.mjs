import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { isHeicName, PREVIEW_FOLDER, PREVIEW_MAX_SIDE, PREVIEW_QUALITY, previewPathFor } from '../../backend/hyper/heic-preview.mjs'
import { previewPathFor as viewerPreviewPathFor } from '../../assets/hyperdrive-viewer/lib/kinds.js'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('a HEIC photo\'s JPEG copy is its own path under /.peersky/previews, plus .jpg', () => {
  assert.equal(PREVIEW_FOLDER, '/.peersky/previews')
  assert.equal(previewPathFor('/IMG_0001.HEIC'), '/.peersky/previews/IMG_0001.HEIC.jpg')
  assert.equal(previewPathFor('/IMG 2 (1).heic'), '/.peersky/previews/IMG 2 (1).heic.jpg')
})

test('the phone and the viewer name the same path', () => {
  for (const path of ['/IMG_0001.HEIC', '/a b/IMG (1).heif', 'IMG.heic']) {
    assert.equal(viewerPreviewPathFor(path), previewPathFor(path))
  }
})

test('HEIC and HEIF names, in any case, are the ones that get a copy', () => {
  for (const name of ['a.heic', 'A.HEIC', 'b.heif', 'x.y.Heic']) assert.equal(isHeicName(name), true)
  for (const name of ['a.jpg', 'heic', 'a.heic.jpg', 'a.heics', '', undefined]) assert.equal(isHeicName(name), false)
})

test('the copy is a 1600 px JPEG at quality 0.8, and a failed copy is dropped before the upload', () => {
  assert.equal(PREVIEW_MAX_SIDE, 1600)
  assert.equal(PREVIEW_QUALITY, 0.8)

  const maker = read('app/hyperdrive/heic-preview.ts')
  assert.match(maker, /SaveFormat\.JPEG/)
  // Every failure ends in null, never a throw, so the screen uploads the photo anyway.
  assert.match(maker, /catch \{\s*return null/)

  const screen = read('app/hyperdrive/HyperdriveScreen.tsx')
  assert.match(screen, /const preview = await makeHeicPreview\(asset\)/)
  assert.match(screen, /previewUri: preview\.uri/)
  assert.match(screen, /discardHeicPreview\(preview\)/)
})
