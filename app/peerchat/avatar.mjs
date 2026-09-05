export const MAX_PEERCHAT_AVATAR_FILE_BYTES = 143 * 1024
const MAX_PEERCHAT_AVATAR_DATA_URL_LENGTH = 192 * 1024
const AVATAR_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])

export function createPeerChatAvatarDataUrl ({ name, mimeType, size, base64 } = {}) {
  const type = normalizeAvatarMimeType(mimeType, name)
  if (!type) throw new Error('Choose a PNG, JPEG, WebP, or GIF image.')
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PEERCHAT_AVATAR_FILE_BYTES) {
    throw new Error('Choose an image smaller than 143 KB.')
  }
  if (typeof base64 !== 'string' || !base64 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) {
    throw new Error('Unable to read the selected image.')
  }
  const dataUrl = `data:${type};base64,${base64}`
  if (dataUrl.length > MAX_PEERCHAT_AVATAR_DATA_URL_LENGTH) {
    throw new Error('Choose an image smaller than 143 KB.')
  }
  return dataUrl
}

function normalizeAvatarMimeType (mimeType, name) {
  const supplied = typeof mimeType === 'string' ? mimeType.toLowerCase().split(';', 1)[0].trim() : ''
  if (supplied === 'image/jpg') return 'image/jpeg'
  if (AVATAR_MIME_TYPES.has(supplied)) return supplied

  const extension = typeof name === 'string' ? name.toLowerCase().match(/[.]([a-z0-9]+)$/)?.[1] : ''
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  return ''
}
