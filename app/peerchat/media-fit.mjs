// A picture or video in a message is shown at its own shape, so its bubble
// fits it with a thin edge, rather than cut to one wide box with the file name
// and size under it. Very tall or very wide ones are held to these bounds and
// cropped to fill them.
export const INLINE_MEDIA_WIDTH = 240
export const INLINE_MEDIA_MAX_HEIGHT = 320
export const INLINE_MEDIA_MIN_WIDTH = 140
export const INLINE_MEDIA_MIN_HEIGHT = 100
// Until the picture or video says how big it is.
export const INLINE_MEDIA_DEFAULT = Object.freeze({ width: INLINE_MEDIA_WIDTH, height: 180 })

export function fitPeerChatMedia (size) {
  const width = Number(size?.width)
  const height = Number(size?.height)
  if (!(width > 0 && height > 0)) return { ...INLINE_MEDIA_DEFAULT }
  const ratio = width / height
  let fittedWidth = INLINE_MEDIA_WIDTH
  let fittedHeight = fittedWidth / ratio
  if (fittedHeight > INLINE_MEDIA_MAX_HEIGHT) {
    fittedHeight = INLINE_MEDIA_MAX_HEIGHT
    fittedWidth = Math.max(INLINE_MEDIA_MIN_WIDTH, fittedHeight * ratio)
  }
  fittedHeight = Math.max(INLINE_MEDIA_MIN_HEIGHT, fittedHeight)
  return { width: Math.round(fittedWidth), height: Math.round(fittedHeight) }
}
