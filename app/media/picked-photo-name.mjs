// Android's photo picker keeps a photo's real name to itself and hands over
// its own number for it instead: "20.jpg". Shown as that, the number told
// nobody anything ("'20.jpg' looks explicit", "Sent 21.jpg"), so such a photo
// goes as "photo.jpg", and a video as "video.mp4".
const PICKER_NUMBER_NAME = /^\d+(\.[a-z0-9]+)$/i

/**
 * @param {string | null | undefined} fileName The name the picker gave.
 * @param {{ android?: boolean, video?: boolean }} picked
 * @returns {string} The name to use, or '' when the picker gave none.
 */
export function pickedPhotoName (fileName, { android = false, video = false } = {}) {
  const name = String(fileName || '')
  const number = android ? PICKER_NUMBER_NAME.exec(name) : null
  return number ? `${video ? 'video' : 'photo'}${number[1].toLowerCase()}` : name
}
