/**
 * One row per person, not one per key.
 *
 * A peer id is derived from a device's key, so somebody who reinstalls, or who
 * joins from a phone as well as a laptop, arrives as a new member with the same
 * name. The room remembers both, and the list then shows them twice or three
 * times over with the same picture.
 *
 * Desktop has always collapsed the list by name. This is the same rule, applied
 * where the list is built so the count, the search and the mentions all agree
 * with what is on screen.
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
  return false
}
