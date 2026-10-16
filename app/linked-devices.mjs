import { msg, t, tKey, tp } from './i18n/i18n.mjs'

// The person's other devices, as Settings > Link Device and Hyperdrive show
// them: what each is, never its name, numbered only when there are two of a
// kind.

const TYPE_NAMES = { phone: msg('Phone'), desktop: msg('Desktop') }
const NUMBERED_TYPE_NAMES = { phone: msg('Phone {number}'), desktop: msg('Desktop {number}') }

/**
 * Each device's kind by id, with its number when there are two of a kind,
 * numbered in the order the devices were first met.
 */
export function numberLinkedDevices (devices = []) {
  const byType = new Map()
  for (const device of [...devices].sort((left, right) => (left.firstSeen || 0) - (right.firstSeen || 0))) {
    if (!TYPE_NAMES[device.type]) continue
    if (!byType.has(device.type)) byType.set(device.type, [])
    byType.get(device.type).push(device)
  }
  const numbered = new Map()
  for (const [type, list] of byType) {
    list.forEach((device, index) => {
      numbered.set(device.id, { type, number: list.length > 1 ? index + 1 : null })
    })
  }
  return numbered
}

/** Each device's label by id, numbered in the order the devices were first met. */
export function labelLinkedDevices (devices = []) {
  const labels = new Map()
  for (const [id, { type, number }] of numberLinkedDevices(devices)) {
    labels.set(id, number ? tKey(NUMBERED_TYPE_NAMES[type], { number }) : tKey(TYPE_NAMES[type]))
  }
  return labels
}

/**
 * Where a file from another device is, beside its size, as one sentence for
 * each kind of device: a language puts the device's name in it the way its
 * grammar needs, which a label dropped into the middle would not let it do.
 */
export function describeDeviceFile ({ type, number }, size) {
  if (type === 'phone') {
    return number ? t('On your phone {number} - {size}', { number, size }) : t('On your phone - {size}', { size })
  }
  return number ? t('On your desktop {number} - {size}', { number, size }) : t('On your desktop - {size}', { size })
}

/** Online ones first, then the one seen most recently. */
export function sortLinkedDevices (devices = []) {
  return [...devices].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1
    return (right.lastSeen || 0) - (left.lastSeen || 0)
  })
}

export function describeLinkedDevice (device, now = Date.now()) {
  if (device.online) return t('Online now')
  if (!device.lastSeen) return t('Not connected yet')
  const minutes = Math.floor((now - device.lastSeen) / 60000)
  if (minutes < 1) return t('Seen just now')
  if (minutes < 60) return tp({ one: 'Seen {count} min ago', other: 'Seen {count} min ago' }, minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return tp({ one: 'Seen {count} hour ago', other: 'Seen {count} hours ago' }, hours)
  const days = Math.floor(hours / 24)
  if (days < 30) return tp({ one: 'Seen {count} day ago', other: 'Seen {count} days ago' }, days)
  return t('Seen on {date}', { date: new Date(device.lastSeen).toLocaleDateString() })
}

/**
 * Whether the phone should tell its other devices it is on a cellular
 * connection, so a desktop waits for Wi-Fi before copying its files.
 */
export function isMeteredNetwork (networkState) {
  return networkState?.type === 'CELLULAR'
}
