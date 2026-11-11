/**
 * The order Room info lists people in while it is open.
 *
 * The list comes sorted: you, then whoever is here, then whoever is away, then
 * everyone else. It comes again with every check the open chat makes, about
 * every second and a half, so taking that order each time moved people up and
 * down while you looked, whenever someone went idle, came back or reconnected.
 * In a busy room that was all the time, and it looked like the list kept
 * loading. The order is taken once, when Room info opens: a dot changes colour
 * where it is, someone new goes at the end, and someone gone is gone. The next
 * time it opens it is sorted again.
 */

// One row per person: the list is collapsed by name, so a person on two
// devices keeps their row when the device it shows changes. Collapsed the same
// way as backend/peerchat/members.mjs.
export function peerChatMemberKey (member) {
  return String(member?.username || member?.id || '').toLocaleLowerCase()
}

/**
 * @param {string[] | null} heldKeys the order to keep, or null to take the
 * list's own
 * @param {Array<{ id?: string, username?: string }>} members the list as it
 * came, sorted
 * @returns {{ members: any[], keys: string[] }} the list to show and the
 * order to keep for next time
 */
export function holdPeerChatMemberOrder (heldKeys, members) {
  const list = Array.isArray(members) ? members : []
  if (!Array.isArray(heldKeys)) return { members: list, keys: list.map(peerChatMemberKey) }

  const place = new Map(heldKeys.map((key, index) => [key, index]))
  const kept = []
  const added = []
  for (const member of list) {
    if (place.has(peerChatMemberKey(member))) kept.push(member)
    else added.push(member)
  }
  kept.sort((left, right) => place.get(peerChatMemberKey(left)) - place.get(peerChatMemberKey(right)))
  const shown = [...kept, ...added]
  return { members: shown, keys: shown.map(peerChatMemberKey) }
}
