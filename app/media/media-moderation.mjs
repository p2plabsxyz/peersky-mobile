// One media gate for every upload (PeerChat attachments, Hyperdrive files,
// P2PMD images), so a new picker cannot skip it. The text filters only see an
// attachment's hyper:// URL, never the picture. This runs before an upload
// leaves the sender, so explicit media never reaches the room. A modified
// build can skip it, as with the text filters, but it stops the ordinary case.

export const MEDIA_ALLOWED = 'allowed'
export const MEDIA_BLOCKED = 'blocked'
export const MEDIA_UNSCANNED = 'unscanned'

// The model reports five classes. Porn and Hentai are explicit; Sexy covers
// nudity and near nudity, which is most of what actually gets posted.
//
// Two lines, because one is not enough. A single photo often splits its score
// across Porn and Sexy so that neither alone looks decisive, and judging the
// classes one at a time lets it through. The first line catches clearly
// explicit content, the second catches everything that is mostly skin however
// the model divides it up.
export const EXPLICIT_CLASSES = new Set(['Porn', 'Hentai'])
export const SUGGESTIVE_CLASSES = new Set(['Sexy'])
export const EXPLICIT_THRESHOLD = 0.45
export const COMBINED_THRESHOLD = 0.7

// A data url needs a real type. 'image/*' is not one: the decoder refuses it,
// the scan comes back unscanned, and the picture sails through. P2PMD hands its
// images over as bare base64 with no type at all, so it is read from the magic
// bytes, the same four formats the backend accepts.
const BASE64_SIGNATURES = [
  ['image/png', 'iVBORw0KGgo'],
  ['image/jpeg', '/9j/'],
  ['image/gif', 'R0lGODdh'],
  ['image/gif', 'R0lGODlh'],
  ['image/webp', 'UklGR']
  // No heic or avif here on purpose. Their magic sits after a length prefix
  // that varies between files, so a base64 prefix match would only catch one
  // size of header and quietly miss the rest. Anything with a file behind it
  // goes through the decoder instead, which reads them properly.
]

export function sniffBase64ImageType (base64) {
  const head = String(base64 || '').slice(0, 16)
  for (const [type, signature] of BASE64_SIGNATURES) {
    if (head.startsWith(signature)) return type
  }
  return ''
}

// Anything that is not a concrete image type the decoder understands.
export function isUsableImageType (mimeType) {
  const type = String(mimeType || '')
  return type.startsWith('image/') && !type.includes('*')
}

// How many files one send may carry. Chosen so an accidental select-all in a
// photo folder does not push a hundred uploads into a room.
export const MAX_UPLOAD_BATCH = 10

// Frames sampled across a video. A clip is explicit if any sampled frame is.
export const VIDEO_FRAME_SAMPLES = 8

const VERDICTS = new Set([MEDIA_ALLOWED, MEDIA_BLOCKED, MEDIA_UNSCANNED])

export function normalizeMediaVerdict (value) {
  return VERDICTS.has(value) ? value : MEDIA_UNSCANNED
}

export function verdictFromPredictions (predictions, thresholds = {}) {
  if (!Array.isArray(predictions) || predictions.length === 0) return MEDIA_UNSCANNED

  const explicitAt = thresholds.explicit ?? EXPLICIT_THRESHOLD
  const combinedAt = thresholds.combined ?? COMBINED_THRESHOLD

  let explicit = 0
  let suggestive = 0
  for (const prediction of predictions) {
    const probability = Number(prediction?.probability) || 0
    if (EXPLICIT_CLASSES.has(prediction?.className)) explicit += probability
    else if (SUGGESTIVE_CLASSES.has(prediction?.className)) suggestive += probability
  }

  if (explicit >= explicitAt) return MEDIA_BLOCKED
  if (explicit + suggestive >= combinedAt) return MEDIA_BLOCKED
  return MEDIA_ALLOWED
}

export function describeBlockedUpload (fileName) {
  const name = fileName ? `'${fileName}'` : 'That file'
  return `${name} looks explicit, so it was not sent. It would be shared with people who did not ask to see it.`
}

// Says what to do with a batch before any of it is uploaded: one refusal stops
// the whole send, so a user never gets half a batch through.
export function screenUploadBatch (results) {
  const blocked = (results || []).filter((entry) => normalizeMediaVerdict(entry?.verdict) === MEDIA_BLOCKED)
  if (blocked.length === 0) return { allowed: true, blocked: [], reason: '' }
  return {
    allowed: false,
    blocked,
    reason: describeBlockedUpload(blocked.length === 1 ? blocked[0].fileName : '')
  }
}

export function isTooManyFiles (count, max = MAX_UPLOAD_BATCH) {
  return Number(count) > max
}

export function describeTooManyFiles (count, max = MAX_UPLOAD_BATCH) {
  return `Pick up to ${max} files at a time. You chose ${count}.`
}

// Evenly spaced, skipping the very first and last frame: a lot of clips open on
// black and end on a cut, and neither tells you anything.
export function videoSampleTimes (duration, samples = VIDEO_FRAME_SAMPLES) {
  const length = Number(duration)
  if (!Number.isFinite(length) || length <= 0) return [0]
  const count = Math.max(1, Math.min(samples, Math.ceil(length)))
  const step = length / (count + 1)
  return Array.from({ length: count }, (_, index) => Number((step * (index + 1)).toFixed(3)))
}
