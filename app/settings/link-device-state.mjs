// The parts of Link Device that are plain logic, kept apart from the screen so
// they can be tested. The backend modules they mirror pull in native code, so
// the one shared number, the passphrase length, is copied here and a test
// keeps the two in step.
import { msg, t, tKey, tp } from '../i18n/i18n.mjs'

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
    return tp({ one: 'Use at least {count} character.', other: 'Use at least {count} characters.' }, MIN_BACKUP_PASSPHRASE_LENGTH)
  }
  if (value !== String(confirmation || '')) return t('The two passphrases do not match.')
  return null
}

export function formatBackupSize (bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 1024 * 1024) return t('under 1 MB')
  if (value < 1024 * 1024 * 1024) return t('{size} MB', { size: Math.round(value / (1024 * 1024)) })
  return t('{size} GB', { size: (value / (1024 * 1024 * 1024)).toFixed(1) })
}

// What a list of backed up files means to a person, in the order they would
// care about it.
const CONTENT_LABELS = [
  [msg('tabs'), ['browser-tabs.json', 'incoming-tabs.json']],
  [msg('bookmarks'), ['browser-bookmarks.json', 'browser-favourites.json', 'incoming-bookmarks.json']],
  [msg('history'), ['browser-history.json']],
  [msg('settings'), ['browser-preferences.json']],
  [msg('chats'), ['hyper-sdk', 'peerchat-intro.json', 'peerchat-ui-state.json', 'peerchat-incoming.json']],
  [msg('notes'), ['hyper-sdk', 'p2pmd-profile.json', 'p2pmd-room-history.json', 'p2pmd-incoming.json']],
  // Not private-drive-key.json: a desktop sends its key even with no private
  // drives, and a transfer with only the key has no files to speak of.
  [msg('private files'), ['hyper-sdk-synced-private', 'hyper-sdk-adopted', 'hyper-private', 'privateHyperdrives.json']],
  [msg('files'), ['hyper-sdk', 'hyper-sdk-private', 'hyperdrive-recents.json']]
]

export function describeBackupContents (names) {
  const present = new Set(Array.isArray(names) ? names : [])
  const labels = CONTENT_LABELS
    .filter(([, files]) => files.some((file) => present.has(file)))
    .map(([label]) => tKey(label))
  if (labels.length === 0) return ''
  // The comma is its own text: some languages list things with another mark.
  const text = labels.length === 1
    ? labels[0]
    : t('{items} and {last}', { items: labels.slice(0, -1).join(t(', ')), last: labels[labels.length - 1] })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Whole phrases for each kind of phone, since the words around the device
// change with it in other languages.
export function describeBackupOrigin ({ createdAt, platform } = {}) {
  const date = new Date(createdAt)
  if (!createdAt || Number.isNaN(date.getTime())) {
    if (platform === 'ios') return t('Made on an iPhone')
    if (platform === 'android') return t('Made on an Android phone')
    return t('Made on a phone')
  }
  const day = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  if (platform === 'ios') return t('Made on an iPhone, {date}', { date: day })
  if (platform === 'android') return t('Made on an Android phone, {date}', { date: day })
  return t('Made on a phone, {date}', { date: day })
}

const PHASE_LABELS = {
  packing: msg('Packing up your data'),
  sharing: msg('Getting it ready to send'),
  downloading: msg('Downloading from the other device'),
  unpacking: msg('Unpacking')
}

export function describeProgress (event) {
  const phase = PHASE_LABELS[event?.phase]
  const label = phase ? tKey(phase) : t('Working')
  const done = Number(event?.done)
  const total = Number(event?.total)
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return { label, fraction: null, detail: '' }
  const fraction = Math.max(0, Math.min(1, done / total))
  return { label, fraction, detail: t('{percent}%', { percent: Math.round(fraction * 100) }) }
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
  if (!Number.isFinite(ms) || ms <= 0) return t('Getting a new code…')
  if (ms < 60 * 1000) return t('This code works for less than a minute more.')
  const minutes = Math.floor(ms / (60 * 1000))
  return tp({ one: 'This code works for {count} more minute.', other: 'This code works for {count} more minutes.' }, minutes)
}

// How long a link this phone is sending has left. Like the pairing code, in
// whole minutes rounded down.
export function describeSendLinkLife (msLeft) {
  const ms = Number(msLeft)
  if (!Number.isFinite(ms) || ms <= 0) return t('This link has run out.')
  if (ms < 60 * 1000) return t('This link works for less than a minute more.')
  const minutes = Math.floor(ms / (60 * 1000))
  return tp({ one: 'This link works for {count} more minute.', other: 'This link works for {count} more minutes.' }, minutes)
}

// How much of a transfer the other device has taken, from the share of its
// blocks this phone has sent, or '' before it starts.
export function describeSendProgress (sent, toDesktop) {
  const share = Number(sent)
  if (!Number.isFinite(share) || share <= 0) return ''
  if (share >= 1) {
    return toDesktop
      ? t('The desktop has all of it. You can stop sending now.')
      : t('The other phone has all of it. You can stop sending now.')
  }
  const percent = Math.floor(share * 100)
  return toDesktop
    ? t('The desktop has {percent}% of it so far.', { percent })
    : t('The other phone has {percent}% of it so far.', { percent })
}
