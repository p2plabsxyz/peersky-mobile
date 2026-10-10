// The person's other devices, as Settings > Link Device and Hyperdrive show
// them: what each is, never its name, numbered only when there are two of a
// kind.

const TYPE_NAMES = { phone: 'Phone', desktop: 'Desktop' }

/** Each device's label by id, numbered in the order the devices were first met. */
export function labelLinkedDevices (devices = []) {
  const byType = new Map()
  for (const device of [...devices].sort((left, right) => (left.firstSeen || 0) - (right.firstSeen || 0))) {
    if (!TYPE_NAMES[device.type]) continue
    if (!byType.has(device.type)) byType.set(device.type, [])
    byType.get(device.type).push(device)
  }
  const labels = new Map()
  for (const [type, list] of byType) {
    list.forEach((device, index) => {
      labels.set(device.id, list.length > 1 ? `${TYPE_NAMES[type]} ${index + 1}` : TYPE_NAMES[type])
    })
  }
  return labels
}

/** Online ones first, then the one seen most recently. */
export function sortLinkedDevices (devices = []) {
  return [...devices].sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1
    return (right.lastSeen || 0) - (left.lastSeen || 0)
  })
}

export function describeLinkedDevice (device, now = Date.now()) {
  if (device.online) return 'Online now'
  if (!device.lastSeen) return 'Not connected yet'
  const minutes = Math.floor((now - device.lastSeen) / 60000)
  if (minutes < 1) return 'Seen just now'
  if (minutes < 60) return `Seen ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Seen ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Seen ${days} ${days === 1 ? 'day' : 'days'} ago`
  return `Seen on ${new Date(device.lastSeen).toLocaleDateString()}`
}

/**
 * Whether the phone should tell its other devices it is on a cellular
 * connection, so a desktop waits for Wi-Fi before copying its files.
 */
export function isMeteredNetwork (networkState) {
  return networkState?.type === 'CELLULAR'
}
