import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  fitPeerChatMedia,
  INLINE_MEDIA_DEFAULT,
  INLINE_MEDIA_MAX_HEIGHT,
  INLINE_MEDIA_MIN_HEIGHT,
  INLINE_MEDIA_MIN_WIDTH,
  INLINE_MEDIA_WIDTH
} from '../../app/peerchat/media-fit.mjs'
import { canSavePeerChatMedia, peerChatMediaType, savedFolderName } from '../../app/peerchat/media-save.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
const screen = await read('app/peerchat/PeerChatScreen.tsx')

test('a picture or video is shown at its own shape, within bounds', () => {
  assert.deepEqual(fitPeerChatMedia(null), INLINE_MEDIA_DEFAULT)
  assert.deepEqual(fitPeerChatMedia({ width: 0, height: 10 }), INLINE_MEDIA_DEFAULT)
  // Landscape: the full width, its own height.
  assert.deepEqual(fitPeerChatMedia({ width: 4000, height: 3000 }), { width: INLINE_MEDIA_WIDTH, height: 180 })
  // Portrait: held to the tallest, narrower.
  assert.deepEqual(fitPeerChatMedia({ width: 3000, height: 4000 }), { width: 240, height: 320 })
  assert.deepEqual(fitPeerChatMedia({ width: 1080, height: 1920 }), { width: 180, height: INLINE_MEDIA_MAX_HEIGHT })
  // Very tall and very wide ones are cropped to fill the bounds.
  assert.deepEqual(fitPeerChatMedia({ width: 100, height: 5000 }), { width: INLINE_MEDIA_MIN_WIDTH, height: INLINE_MEDIA_MAX_HEIGHT })
  assert.deepEqual(fitPeerChatMedia({ width: 5000, height: 100 }), { width: INLINE_MEDIA_WIDTH, height: INLINE_MEDIA_MIN_HEIGHT })
})

// A picture's bubble was much bigger than the picture: a wide bubble with a
// border and the file's name and size under it.
test('a picture or video bubble fits it with a thin edge and no name or size', () => {
  assert.match(screen, /messageBubbleMedia: \{ minWidth: 0, paddingHorizontal: 4, paddingVertical: 4 \}/)
  assert.match(screen, /media \? styles\.messageBubbleMedia : null/)
  assert.match(screen, /inlineMedia: \{ borderRadius: 12, overflow: 'hidden' \}/)
  const attachment = screen.slice(screen.indexOf('function PeerChatAttachment ('), screen.indexOf('function PeerChatVideo ('))
  const media = attachment.slice(attachment.indexOf("if (mediaUrl && mediaKind === 'image' && (isScreening"), attachment.indexOf("  return (\n    <Pressable\n      accessibilityHint={t('Opens this Hyperdrive attachment"))
  assert.doesNotMatch(media, /AttachmentCaption/)
  assert.doesNotMatch(media, /borderWidth|borderColor/)
  assert.match(media, /onLoad=\{\(\{ nativeEvent \}\) => noteMediaSize\(nativeEvent\.source\)\}/)
  assert.match(media, /<PeerChatVideo mediaUrl=\{mediaUrl\} onSize=\{noteMediaSize\} \/>/)
  // Any other file keeps its name and size.
  assert.match(attachment.slice(attachment.indexOf("accessibilityHint={t('Opens this Hyperdrive attachment")), /<AttachmentCaption colors=\{colors\} item=\{item\}/)
  // A video plays full screen from a tap on it, and holding it opens the
  // message's actions, as a picture does.
  assert.match(media, /accessibilityHint=\{t\('Plays this video full screen\. Long press for message actions'\)\}/)
  assert.match(screen, /nativeControls=\{fullScreen\}/)
})

test('a picture or video saves with its own type, and only from a copy on this phone', () => {
  assert.equal(peerChatMediaType('beach.JPG'), 'image/jpeg')
  assert.equal(peerChatMediaType('IMG_0001.heic'), 'image/heic')
  assert.equal(peerChatMediaType('clip.mov'), 'video/quicktime')
  assert.equal(peerChatMediaType('notes.pdf'), '')
  assert.equal(canSavePeerChatMedia({ kind: 'image', uri: 'file:///data/cache/beach.jpg', fileName: 'beach.jpg', label: '' }), true)
  assert.equal(canSavePeerChatMedia({ kind: 'video', uri: 'file:///data/cache/clip.mp4', fileName: 'clip.mp4', label: '' }), true)
  // A profile picture carried in the profile has nothing to save.
  assert.equal(canSavePeerChatMedia({ kind: 'image', uri: 'data:image/jpeg;base64,AAAA', label: 'Ada' }), false)
  assert.equal(canSavePeerChatMedia({ kind: 'image', uri: 'http://127.0.0.1/asset', fileName: 'a.png', label: '' }), false)
  assert.equal(canSavePeerChatMedia(null), false)
  assert.equal(savedFolderName('content://com.android.externalstorage.documents/tree/primary%3APictures'), 'Pictures')
  assert.equal(savedFolderName('content://com.android.externalstorage.documents/tree/primary%3APictures%2FPeerSky'), 'Pictures/PeerSky')
  assert.equal(savedFolderName('nonsense'), 'the folder you picked')
})

test('Save is in the picture viewer and in the message\'s long-press menu', async () => {
  const viewer = screen.slice(screen.indexOf('function PeerChatMediaViewer ('), screen.indexOf('function AttachmentCaption ('))
  assert.match(viewer, /\{canSave && \(\s+<Pressable\s+accessibilityLabel=\{Platform\.OS === 'ios' \? t\('Save to Photos'\) : t\('Save to gallery'\)\}/)
  assert.match(viewer, /savePeerChatMedia\(\{ uri: target\.uri, fileName: target\.fileName \}\)/)
  const menu = screen.slice(screen.indexOf('visible={messageActionTarget !== null}'), screen.indexOf('visible={isAttachSheetOpen}'))
  assert.match(menu, /\{canSaveMessageMedia\(messageActionTarget\) && \(\s+<Pressable accessibilityRole='button' onPress=\{\(\) => saveMessageMedia\(messageActionTarget\)\}/)
  // The menu closes first: iOS shows its own sheet to save to Photos.
  const save = screen.slice(screen.indexOf('function saveMessageMedia ('), screen.indexOf('function replyToMessage ('))
  assert.match(save, /replaceModal\(\(\) => setMessageActionTarget\(null\), \(\) => \{/)
  assert.match(save, /RPC_PEERCHAT_ATTACHMENT_OPEN/)

  // The ways the app already saves files, and no new permission: the share
  // sheet's Save Image on iOS, under the add-to-Photos reason the app has, and
  // a folder picked once with the system's picker on Android.
  const helper = await read('app/peerchat/media-save.ts')
  assert.match(helper, /await Sharing\.shareAsync\(namedCopy\(uri, fileName\), \{/)
  assert.match(helper, /Directory\.pickDirectoryAsync\(PICTURES_FOLDER\)/)
  assert.match(helper, /handle\.readBytes\(COPY_CHUNK_BYTES\)/)
  assert.doesNotMatch(helper, /expo-media-library|MediaLibrary/)
  const app = JSON.parse(await read('app.json'))
  assert.match(app.expo.ios.infoPlist.NSPhotoLibraryAddUsageDescription, /Save to Photos/)
})

// Clear all P2P data said the chats go. Copies of their pictures outside the
// stores stayed: the picture check's small JPEG of every picture in a room,
// and what Save and Share handed on.
test('a picture check keeps no copy, and clearing the chats clears the copies', async () => {
  const scanner = await read('app/media/NsfwScanner.tsx')
  assert.match(scanner, /jpegUri = jpeg\.uri/)
  assert.match(scanner, /finally \{[\s\S]{0,400}if \(jpegUri\) new File\(jpegUri\)\.delete\(\)/)

  const helper = await read('app/peerchat/media-save.ts')
  // The pickers' own full copies go too: chat pictures with their location,
  // and files uploaded as Private.
  assert.match(helper, /for \(const name of \['peerchat-save', 'ImageManipulator', 'ImagePicker', 'DocumentPicker'\]\)/)
  assert.match(helper, /new Directory\(Paths\.cache, 'peerchat-save'\)/, 'the folder Save and Share write to')

  const storage = await read('app/settings/P2PStorage.tsx')
  const clearAll = storage.slice(storage.indexOf('async function clearAllData'), storage.indexOf('async function refreshArchive'))
  assert.ok(clearAll.indexOf('clearChatFileCopies()') > -1 && clearAll.indexOf('clearChatFileCopies()') < clearAll.indexOf('RPC_HYPER_STORAGE_CLEAR_ALL'))

  const linkDevice = await read('app/settings/LinkDevice.tsx')
  const replace = linkDevice.slice(linkDevice.indexOf('const replaceData = useCallback'), linkDevice.indexOf('const commitRestore'))
  assert.ok(replace.indexOf('clearChatFileCopies()') > -1 && replace.indexOf('clearChatFileCopies()') < replace.indexOf('await call(command, data)'))
})
