import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_LOCAL_FILE_URI_LENGTH,
  normalizePickedLocalFile
} from '../../backend/hyper/local-file.mjs'

// The rule lived twice, once for PeerChat attachments and once for Hyperdrive
// uploads, and both only knew about the Files browser. Offering the camera roll
// on the attach sheet meant a photo arrived from ImagePicker's cache and both
// copies called it invalid.

const accepted = (uri) => normalizePickedLocalFile(uri, 10) !== null

test('a file picked from Files is accepted', () => {
  assert.equal(accepted('file:///data/user/0/xyz.p2plabs.peersky/cache/DocumentPicker/a.mp4'), true)
})

test('a photo from the camera roll is accepted on both platforms', () => {
  assert.equal(accepted('file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/b.jpg'), true)
  assert.equal(accepted('file:///data/user/0/xyz.p2plabs.peersky/cache/ImagePicker/c.jpg'), true)
})

test('a staged folder upload is accepted', () => {
  assert.equal(accepted('file:///data/user/0/xyz.p2plabs.peersky/cache/peersky-upload/d.png'), true)
})

test('a file the app did not copy is refused', () => {
  assert.equal(accepted('file:///data/user/0/xyz.p2plabs.peersky/files/private.txt'), false)
  assert.equal(accepted('file:///etc/passwd'), false)
})

test('a path that climbs out of the picker cache is refused', () => {
  assert.equal(accepted('file:///data/user/0/x/cache/DocumentPicker/../../files/private.txt'), false)
})

test('anything that is not a plain file uri is refused', () => {
  assert.equal(accepted('content://media/external/images/1'), false)
  assert.equal(accepted('file://host/cache/DocumentPicker/a.jpg'), false)
  assert.equal(accepted('file:///cache/DocumentPicker/a.jpg?x=1'), false)
  assert.equal(accepted('file:///cache/DocumentPicker/a.jpg#x'), false)
  assert.equal(accepted('file:///cache/DocumentPicker/a\0.jpg'), false)
})

test('a missing or absurd length is refused', () => {
  assert.equal(normalizePickedLocalFile('file:///cache/DocumentPicker/a.jpg', 0), null)
  assert.equal(normalizePickedLocalFile('file:///cache/DocumentPicker/a.jpg', -1), null)
  assert.equal(normalizePickedLocalFile('file:///cache/DocumentPicker/a.jpg', 1.5), null)
})

test('an absurdly long uri is refused before it is parsed', () => {
  const long = 'file:///cache/DocumentPicker/' + 'a'.repeat(MAX_LOCAL_FILE_URI_LENGTH) + '.jpg'
  assert.equal(normalizePickedLocalFile(long, 10), null)
})

test('the resolved path keeps its real spelling', () => {
  const resolved = normalizePickedLocalFile('file:///cache/ImagePicker/my%20photo.jpg', 42)
  assert.deepEqual(resolved, { path: '/cache/ImagePicker/my photo.jpg', byteLength: 42 })
})
