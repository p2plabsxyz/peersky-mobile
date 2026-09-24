// Turns a note's own text into something a person can recognise in a list.
//
// Purely cosmetic. A note is still addressed by its key everywhere that
// matters; this only decides what the key is displayed as.
//
// Mirror of note-title.js in p2pmd. Keep them in step.

// The same rule the editor uses to decide where one slide ends and the next
// begins, so a deck is called a deck for exactly the reason it renders as one.
const SLIDE_BREAK = /(?:\r?\n\r?\n---\r?\n\r?\n|^---\r?\n\r?\n|\r?\n\r?\n---$|^<!-- slide -->$)/m
const IEEE_MARKER = /^\s*<!--\s*ieee\s*-->/i
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m

export const P2PMD_NOTE_KIND_LABELS = {
  note: 'Note',
  paper: 'Research paper',
  slides: 'Slides',
  technical: 'Technical document'
}

// Long enough to tell two notes apart, short enough for one line on a phone.
const MAX_TITLE_LENGTH = 48

function stripMarkdown (value) {
  return String(value || '')
    // Link and image text is what a reader sees; the target is noise here.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function p2pmdNoteTitle (content) {
  const text = String(content || '')
  const heading = HEADING.exec(text)
  // A heading is what the writer chose to call it. Without one, the first
  // line they typed is the next best thing.
  const candidate = heading
    ? stripMarkdown(heading[1])
    : stripMarkdown((text.split('\n').find((line) => stripMarkdown(line)) || ''))

  if (!candidate) return ''
  return candidate.length > MAX_TITLE_LENGTH
    ? `${candidate.slice(0, MAX_TITLE_LENGTH).trimEnd()}...`
    : candidate
}

export function p2pmdNoteKind (content, { slides = false } = {}) {
  const text = String(content || '')
  if (IEEE_MARKER.test(text)) return 'paper'
  // The editor already knows whether it split the note into slides. Trusting
  // that beats re-deriving it from a copy of the text that may be truncated.
  if (slides || SLIDE_BREAK.test(text)) return 'slides'
  // The technical template leads with this heading. Once someone rewrites it
  // the note is theirs, and their own heading is the better label anyway.
  if (/^technical documentation\b/i.test(p2pmdNoteTitle(text))) return 'technical'
  return 'note'
}

/**
 * Returns { kind, title, label }. The label is what goes in a list.
 */
export function describeP2pmdNote (content, hint) {
  const kind = p2pmdNoteKind(content, hint)
  const title = p2pmdNoteTitle(content)
  const kindLabel = P2PMD_NOTE_KIND_LABELS[kind]
  return {
    kind,
    title,
    label: title ? `${kindLabel} - ${title}` : kindLabel
  }
}
