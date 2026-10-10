// When a tab was closed, the way the list says it: "Just now", "5 min ago",
// "2 h ago", then the day.
export function formatClosedTabTime (closedAt, now = Date.now()) {
  const elapsed = Math.max(0, now - Number(closedAt || 0))
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}
