import { t } from '../i18n/i18n.mjs'

// The type a saved picture or video is given, so the gallery or Photos takes
// it for what it is. From the name, which is all a message says about it.
const MEDIA_TYPES = {
  avif: 'image/avif',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  '3gp': 'video/3gpp',
  avi: 'video/x-msvideo',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  webm: 'video/webm'
}

export function peerChatMediaType (fileName) {
  const extension = String(fileName || '').toLocaleLowerCase().split('.').pop() || ''
  return MEDIA_TYPES[extension] || ''
}

// A picture or video in a chat can be saved once this phone has opened it,
// which leaves a copy here to save from. A link to elsewhere, or a profile
// picture carried in the profile itself, has nothing to save.
export function canSavePeerChatMedia (target) {
  return Boolean(target) &&
    (target.kind === 'image' || target.kind === 'video') &&
    typeof target.uri === 'string' &&
    target.uri.startsWith('file://') &&
    Boolean(peerChatMediaType(target.fileName))
}

// The folder a save goes to on Android, from its address, as the system's own
// folder picker names it: "Pictures", or "Pictures/PeerSky".
export function savedFolderName (uri) {
  const value = String(uri || '')
  const tree = value.split('/tree/')[1] || value.split('/document/')[1] || ''
  try {
    const path = decodeURIComponent(tree.split('/')[0]).split(':').slice(1).join(':')
    return path || t('the folder you picked')
  } catch {
    return t('the folder you picked')
  }
}
