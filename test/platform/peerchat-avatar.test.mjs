import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPeerChatAvatarDataUrl,
  MAX_PEERCHAT_AVATAR_FILE_BYTES
} from '../../app/peerchat/avatar.mjs'

test('PeerChat creates bounded avatar data URLs from supported images', () => {
  assert.equal(
    createPeerChatAvatarDataUrl({ name: 'avatar.png', mimeType: 'image/png', size: 1, base64: 'YQ==' }),
    'data:image/png;base64,YQ=='
  )
  assert.equal(
    createPeerChatAvatarDataUrl({ name: 'avatar.JPG', size: 1, base64: 'YQ==' }),
    'data:image/jpeg;base64,YQ=='
  )
})

test('PeerChat rejects unsupported, empty, malformed, and oversized avatars', () => {
  assert.throws(
    () => createPeerChatAvatarDataUrl({ name: 'avatar.svg', mimeType: 'image/svg+xml', size: 1, base64: 'YQ==' }),
    /PNG, JPEG, WebP, or GIF/
  )
  assert.throws(
    () => createPeerChatAvatarDataUrl({ name: 'avatar.png', mimeType: 'image/png', size: 0, base64: 'YQ==' }),
    /smaller than 143 KB/
  )
  assert.throws(
    () => createPeerChatAvatarDataUrl({ name: 'avatar.png', mimeType: 'image/png', size: MAX_PEERCHAT_AVATAR_FILE_BYTES + 1, base64: 'YQ==' }),
    /smaller than 143 KB/
  )
  assert.throws(
    () => createPeerChatAvatarDataUrl({ name: 'avatar.png', mimeType: 'image/png', size: 1, base64: 'not base64!' }),
    /Unable to read/
  )
})
