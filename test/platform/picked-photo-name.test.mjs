import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { pickedPhotoName } from '../../app/media/picked-photo-name.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('a photo Android\'s picker names by its number goes as photo.jpg', () => {
  assert.equal(pickedPhotoName('20.jpg', { android: true }), 'photo.jpg')
  assert.equal(pickedPhotoName('21.JPEG', { android: true }), 'photo.jpeg')
  assert.equal(pickedPhotoName('7.png', { android: true }), 'photo.png')
  assert.equal(pickedPhotoName('34.mp4', { android: true, video: true }), 'video.mp4')
})

test('a real name stays as it is', () => {
  assert.equal(pickedPhotoName('IMG_0111.HEIC', { android: true }), 'IMG_0111.HEIC')
  assert.equal(pickedPhotoName('beach 2026.jpg', { android: true }), 'beach 2026.jpg')
  // Only Android's picker hides names, so a number on iPhone is the name.
  assert.equal(pickedPhotoName('20.jpg', { android: false }), '20.jpg')
})

test('no name stays no name, so the uri can stand in', () => {
  assert.equal(pickedPhotoName(undefined, { android: true }), '')
  assert.equal(pickedPhotoName(null), '')
  assert.equal(pickedPhotoName('', { android: true }), '')
})

test('the photo picker names what it picks this way', async () => {
  const gate = await read('app/media/upload-gate.ts')
  assert.match(gate, /name: pickedPhotoName\(asset\.fileName, \{ android: Platform\.OS === 'android', video: asset\.type === 'video' \}\) \|\|\n\s+nameFromUri\(file\.uri, asset\.mimeType\)/)
})
