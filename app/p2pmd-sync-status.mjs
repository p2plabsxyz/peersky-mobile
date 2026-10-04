// Typing flipped the status through Unsaved changes, Syncing... and Saved on
// every keystroke. Unsaved work is a dot now, a saved note says nothing, and
// anything worth reading, like an error or a publish, is still spelled out.
const UNSAVED = new Set(['Unsaved changes', 'Syncing...'])
const QUIET = new Set(['Saved', 'Loaded', 'Remote update', 'Ready', 'Image uploaded'])

export function getP2pmdSyncDisplay (status) {
  const text = typeof status === 'string' ? status : ''
  if (UNSAVED.has(text)) return { kind: 'dot' }
  if (!text || QUIET.has(text)) return { kind: 'none' }
  return { kind: 'text', text }
}
