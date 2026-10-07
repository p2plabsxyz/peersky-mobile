// The parts of Link Device that are plain logic, kept apart from the screen so
// they can be tested. The backend modules they mirror pull in native code, so
// the one shared number, the passphrase length, is copied here and a test
// keeps the two in step.
export const MIN_BACKUP_PASSPHRASE_LENGTH = 12
export const BACKUP_FILE_EXTENSION = '.peersky'

export function toBareFsPath (uri) {
  const value = String(uri || '')
  if (!value.startsWith('file://')) return value
  return decodeURIComponent(new URL(value).pathname).replace(/\/$/, '')
}

export function createBackupFileName (date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `peersky-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}${BACKUP_FILE_EXTENSION}`
}

export function checkNewPassphrase (passphrase, confirmation) {
  const value = String(passphrase || '')
  if (value.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters.`
  }
  if (value !== String(confirmation || '')) return 'The two passphrases do not match.'
  return null
}

export function formatBackupSize (bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 1024 * 1024) return 'under 1 MB'
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / (1024 * 1024))} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// What a list of backed up files means to a person, in the order they would
// care about it.
const CONTENT_LABELS = [
  ['tabs', ['browser-tabs.json', 'incoming-tabs.json']],
  ['bookmarks', ['browser-bookmarks.json', 'browser-favourites.json', 'incoming-bookmarks.json']],
  ['history', ['browser-history.json']],
  ['settings', ['browser-preferences.json']],
  ['chats', ['hyper-sdk', 'peerchat-intro.json', 'peerchat-ui-state.json', 'peerchat-incoming.json']],
  ['notes', ['hyper-sdk', 'p2pmd-profile.json', 'p2pmd-room-history.json', 'p2pmd-incoming.json']],
  // Not private-drive-key.json: a desktop sends its key even with no private
  // drives, and a transfer with only the key has no files to speak of.
  ['private files', ['hyper-sdk-synced-private', 'hyper-sdk-adopted', 'hyper-private', 'privateHyperdrives.json']],
  ['files', ['hyper-sdk', 'hyper-sdk-private', 'hyperdrive-recents.json']]
]

export function describeBackupContents (names) {
  const present = new Set(Array.isArray(names) ? names : [])
  const labels = CONTENT_LABELS
    .filter(([, files]) => files.some((file) => present.has(file)))
    .map(([label]) => label)
  if (labels.length === 0) return ''
  const text = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function describeBackupOrigin ({ createdAt, platform } = {}) {
  const device = platform === 'ios' ? 'an iPhone' : platform === 'android' ? 'an Android phone' : 'a phone'
  const date = new Date(createdAt)
  if (!createdAt || Number.isNaN(date.getTime())) return `Made on ${device}`
  const day = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return `Made on ${device}, ${day}`
}

const PHASE_LABELS = {
  packing: 'Packing up your data',
  sharing: 'Getting it ready to send',
  downloading: 'Downloading from the other device',
  unpacking: 'Unpacking'
}

export function describeProgress (event) {
  const label = PHASE_LABELS[event?.phase] || 'Working'
  const done = Number(event?.done)
  const total = Number(event?.total)
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return { label, fraction: null, detail: '' }
  const fraction = Math.max(0, Math.min(1, done / total))
  return { label, fraction, detail: `${Math.round(fraction * 100)}%` }
}

export function parseProgressEvent (data) {
  try {
    const value = typeof data === 'string' ? JSON.parse(data) : data
    if (!value || typeof value.phase !== 'string') return null
    return { phase: value.phase, done: Number(value.done) || 0, total: Number(value.total) || null }
  } catch {
    return null
  }
}

// How long the pairing code on Receive here has left, in whole minutes rounded
// down, so it never promises more time than the code really has.
export function describePairingCodeLife (msLeft) {
  const ms = Number(msLeft)
  if (!Number.isFinite(ms) || ms <= 0) return 'Getting a new code…'
  if (ms < 60 * 1000) return 'This code works for less than a minute more.'
  const minutes = Math.floor(ms / (60 * 1000))
  return `This code works for ${minutes} more ${minutes === 1 ? 'minute' : 'minutes'}.`
}
