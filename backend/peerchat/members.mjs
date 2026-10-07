/**
 * One row per person, not one per key. A peer id comes from a device's key, so
 * a reinstall or a second device shows up as another member with the same
 * name. Desktop collapses the list by name too. Doing it where the list is
 * built keeps the count, search and mentions in line with what is on screen.
 */
export function collapsePeerChatMembers (members) {
  const byName = new Map()

  for (const member of members) {
    const name = String(member?.username || member?.id || '').toLocaleLowerCase()
    if (!name) continue
    const existing = byName.get(name)
    if (!existing || prefers(member, existing)) byName.set(name, member)
  }

  return [...byName.values()]
}

// You are always yourself. Failing that, the copy that is here now is the one
// worth showing, because it is the one that can be messaged.
function prefers (candidate, existing) {
  if (candidate.self !== existing.self) return candidate.self === true
  if (candidate.online !== existing.online) return candidate.online === true
  // Away on one device and here on another is here.
  if (candidate.online && !candidate.idle !== !existing.idle) return !candidate.idle
  return false
}
