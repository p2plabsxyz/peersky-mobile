import { tKey } from './i18n/i18n.mjs'

// Typing flipped the status through Unsaved changes, Syncing... and Saved on
// every keystroke. Unsaved work is a dot now, a saved note says nothing, and
// anything worth reading, like an error or a publish, is still spelled out.
const UNSAVED = ['Unsaved changes', 'Syncing...']
const QUIET = ['Saved', 'Loaded', 'Remote update', 'Ready', 'Image uploaded']

// A status is matched in English or in the language shown, whichever it was
// set in.
function isOneOf (statuses, text) {
  return statuses.some((status) => status === text || tKey(status) === text)
}

export function getP2pmdSyncDisplay (status) {
  const text = typeof status === 'string' ? status : ''
  if (isOneOf(UNSAVED, text)) return { kind: 'dot' }
  if (!text || isOneOf(QUIET, text)) return { kind: 'none' }
  return { kind: 'text', text: tKey(text) }
}
