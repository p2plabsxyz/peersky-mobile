// Back-to-back messages from one person sit together under one name, the way
// other chat apps show them, and as the desktop does (lib/message-groups.js
// in PeerChat). A gap of a few minutes or a new day starts a new group.
export const GROUP_GAP_MS = 5 * 60_000

// Whether a message joins the group of the one before it. Each is
// { sender, ts }, with every message of yours under one sender.
export function joinsGroup (before, after) {
  if (!before?.sender || before.sender !== after?.sender) return false
  const gap = after.ts - before.ts
  if (!(gap >= 0 && gap < GROUP_GAP_MS)) return false
  return new Date(before.ts).toDateString() === new Date(after.ts).toDateString()
}

// How each message, oldest first, sits with the ones beside it: grouped under
// the name of the one before it, followed by one more of the group, and with
// its time left off when the next one in the group shows the same time, so
// the last of a group always has one. Anything shown between two messages
// keeps them apart: a notice is a message of its own and joins nothing, and a
// date line only comes with a new day.
export function groupPeerChatMessages (messages, timeText) {
  const list = Array.isArray(messages) ? messages : []
  const places = list.map(() => ({ grouped: false, followed: false, sameTime: false }))
  for (let index = 1; index < list.length; index += 1) {
    const before = list[index - 1]
    const after = list[index]
    if (!joinsGroup(groupKey(before), groupKey(after))) continue
    places[index].grouped = true
    places[index - 1].followed = true
    if (timeText(before) === timeText(after)) places[index - 1].sameTime = true
  }
  return places
}

function groupKey (message) {
  const sender = message?.system ? '' : message?.self ? 'self' : String(message?.sender || '')
  return { sender, ts: Number(message?.timestamp) || 0 }
}
