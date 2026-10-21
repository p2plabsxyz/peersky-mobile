// What a file reads as where its message is shown in a single line: the chat
// list, a notification, a search result. A picture or a video by what it is,
// as other chat apps show them, and any other file by its name. Never its
// hyper:// address, which is all the message text of a file is.

// heic and heif are what an iPhone camera writes by default.
const IMAGE_NAME = /\.(?:avif|gif|heic|heif|jpe?g|png|webp)$/i
const VIDEO_NAME = /\.(?:3gp|avi|m4v|mkv|mov|mp4|webm)$/i

export function attachmentKind (fileName) {
  const name = typeof fileName === 'string' ? fileName.trim() : ''
  if (IMAGE_NAME.test(name)) return 'image'
  if (VIDEO_NAME.test(name)) return 'video'
  return null
}

export function attachmentLabel (fileName) {
  const kind = attachmentKind(fileName)
  if (kind === 'image') return 'Photo'
  if (kind === 'video') return 'Video'
  const name = typeof fileName === 'string' ? fileName.trim() : ''
  return name || 'File'
}
