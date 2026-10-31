// A photo sent in a chat leaves the phone as a fresh image. The original file
// carries its EXIF, the place it was taken among it, and everyone in the room
// could read that. An iPhone saves photos as HEIC, which no desktop browser
// can show. Re-encoded, it has neither. A file picked from Files goes as it is,
// and so does a GIF, which would lose its animation.

const REENCODED = {
  jpeg: { format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' },
  png: { format: 'png', extension: 'png', mimeType: 'image/png' }
}

const PHOTO_TYPES = {
  'image/jpeg': REENCODED.jpeg,
  'image/jpg': REENCODED.jpeg,
  'image/pjpeg': REENCODED.jpeg,
  'image/heic': REENCODED.jpeg,
  'image/heif': REENCODED.jpeg,
  'image/heic-sequence': REENCODED.jpeg,
  'image/heif-sequence': REENCODED.jpeg,
  'image/webp': REENCODED.jpeg,
  'image/png': REENCODED.png
}

const PHOTO_EXTENSIONS = {
  jpg: REENCODED.jpeg,
  jpeg: REENCODED.jpeg,
  heic: REENCODED.jpeg,
  heif: REENCODED.jpeg,
  webp: REENCODED.jpeg,
  png: REENCODED.png
}

/**
 * How a picked file goes to a chat: null to send it as it is, or the format,
 * name and type of the clean copy to send instead.
 *
 * @param {{ name?: string, mimeType?: string }} asset
 * @param {'files' | 'library' | 'camera'} source
 */
export function chatPicturePlan (asset, source) {
  if (source !== 'library' && source !== 'camera') return null
  const name = String(asset?.name || '')
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const target = PHOTO_TYPES[String(asset?.mimeType || '').toLowerCase()] || PHOTO_EXTENSIONS[extension]
  if (!target) return null
  const stem = (dot > 0 ? name.slice(0, dot) : name) || 'photo'
  return { format: target.format, name: `${stem}.${target.extension}`, mimeType: target.mimeType }
}
