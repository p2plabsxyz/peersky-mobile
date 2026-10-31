import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { chatPicturePlan } from '../../app/media/chat-picture.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('a photo for a chat is sent as a clean copy, HEIC as a JPEG', () => {
  assert.deepEqual(chatPicturePlan({ name: 'IMG_0111.HEIC', mimeType: 'image/heic' }, 'library'),
    { format: 'jpeg', name: 'IMG_0111.jpg', mimeType: 'image/jpeg' })
  assert.deepEqual(chatPicturePlan({ name: 'beach.jpeg', mimeType: 'image/jpeg' }, 'camera'),
    { format: 'jpeg', name: 'beach.jpg', mimeType: 'image/jpeg' })
  assert.deepEqual(chatPicturePlan({ name: 'shot.png', mimeType: 'image/png' }, 'library'),
    { format: 'png', name: 'shot.png', mimeType: 'image/png' })
  // The type can be missing; the name still says what it is.
  assert.deepEqual(chatPicturePlan({ name: 'IMG_2.heif', mimeType: '' }, 'library'),
    { format: 'jpeg', name: 'IMG_2.jpg', mimeType: 'image/jpeg' })
})

test('a file from Files, a GIF or a video goes as it is', () => {
  assert.equal(chatPicturePlan({ name: 'scan.jpg', mimeType: 'image/jpeg' }, 'files'), null)
  assert.equal(chatPicturePlan({ name: 'party.gif', mimeType: 'image/gif' }, 'library'), null)
  assert.equal(chatPicturePlan({ name: 'clip.mov', mimeType: 'video/quicktime' }, 'camera'), null)
  assert.equal(chatPicturePlan({ name: 'notes.pdf', mimeType: 'application/pdf' }, 'library'), null)
})

test('PeerChat sends the clean copies and deletes them afterwards', async () => {
  const screen = await read('app/peerchat/PeerChatScreen.tsx')
  assert.match(screen, /const \{ assets, copies \} = await prepareChatPictures\(picked, source\)\s+try \{\s+await sendAttachments\(assets\)\s+\} finally \{\s+deleteChatPictureCopies\(copies\)\s+\}/)
  const copies = await read('app/media/chat-picture-copies.ts')
  // A fresh image from the manipulator carries no EXIF from the original.
  assert.match(copies, /ImageManipulator\.manipulate\(asset\.uri\)\.renderAsync\(\)/)
})
