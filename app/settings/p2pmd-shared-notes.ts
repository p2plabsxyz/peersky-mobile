// P2PMD notes that went to a desktop with their text. From then on this phone
// looks for them on the desktop before hosting them itself. Link Device lives
// in settings and the recent notes list in the browser screen, so the two
// meet here.
const listeners = new Set<(keys: string[]) => void>()

export function emitP2pmdNotesShared (keys: unknown) {
  if (!Array.isArray(keys)) return
  const valid = keys.filter((key): key is string => typeof key === 'string' && key.length > 0)
  if (valid.length === 0) return
  for (const listener of listeners) listener(valid)
}

export function subscribeP2pmdNotesShared (listener: (keys: string[]) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
