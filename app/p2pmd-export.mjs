// P2PMD's share button: Share invite, Export PDF, and Export slides for a
// deck, as the desktop's Export menu offers. The note comes from the editor
// page (shareInfo in backend/p2pmd/server.mjs), asked for with a nonce the app
// makes, so only an answer to this app's own question is taken.

import { p2pmdNoteTitle } from './p2pmd-note-title.mjs'

export const P2PMD_SHARE_INFO_TYPE = 'p2pmd-share-info'
// A note holds up to 10 MB of text (backend/p2pmd/document.mjs).
const MAX_SHARE_CONTENT_LENGTH = 10 * 1024 * 1024

export function createP2pmdShareInfoScript (nonce) {
  return `window.__p2pmdShareInfo && window.__p2pmdShareInfo(${JSON.stringify(String(nonce || ''))}); true;`
}

/**
 * The note from the page's answer, or null when it is not the answer to this
 * nonce. slides is whether the note reads as a deck, the same check the
 * editor uses to split it into slides.
 */
export function readP2pmdShareInfo (message, nonce) {
  if (!message || message.type !== P2PMD_SHARE_INFO_TYPE) return null
  if (!nonce || message.nonce !== nonce) return null
  if (typeof message.content !== 'string' || message.content.length > MAX_SHARE_CONTENT_LENGTH) return null
  return {
    content: message.content,
    slides: message.slideBreaks === true,
    latexModeEnabled: message.latexModeEnabled === true
  }
}

// Named as the desktop names an export (normalizeFileBase in p2pmd's p2p.js):
// the note's title, else its key, in lower case with dashes.
export function p2pmdExportFileName (content, roomKey, kind) {
  const base = String(p2pmdNoteTitle(content) || roomKey || '')
    .trim()
    .replace(/\.\.\.$/, '')
    .replace(/^hs:\/\//i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'p2pmd-document'
  return kind === 'slides' ? `${base}.slides.html` : `${base}.pdf`
}
