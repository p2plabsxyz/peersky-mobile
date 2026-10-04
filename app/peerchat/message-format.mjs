import { splitPeerChatMessageParts } from './message-text.mjs'

// A fence opens with ``` (a language name after it is allowed and dropped)
// and closes with the next ```. An unclosed fence stays as typed.
const FENCE = /```[^\n`]*\n?([\s\S]*?)```/g
const HEADING = /^(#{1,3})[ \t]+(\S.*)$/
const INLINE_CODE = /`([^`\n]+)`/g
// Pairs that open and close on a non-space, the way people type them. An
// underscore only counts at a word's edge, so snake_case stays as it is.
const BOLD = /\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*/g
const STAR_ITALIC = /(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g
const UNDERSCORE_ITALIC = /(^|[^\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g
const STRIKE = /(^|[^\w~])~(?=[^\s~])([^~\n]*?[^\s~])~(?![\w~])/g

/**
 * A message as blocks: code fences, headings (#, ## and ###) and paragraphs,
 * the last two made of styled runs. Links and mentions come through whole,
 * the same as without formatting, and nothing inside code is read as anything.
 */
export function formatPeerChatMessage (message, usernames) {
  const text = typeof message === 'string' ? message : ''
  const blocks = []
  let cursor = 0

  for (const match of text.matchAll(FENCE)) {
    pushProse(blocks, text.slice(cursor, match.index), usernames)
    blocks.push({ type: 'code', text: match[1].replace(/\n$/, '') })
    cursor = match.index + match[0].length
  }
  pushProse(blocks, text.slice(cursor), usernames)

  return blocks.length > 0 ? blocks : [{ type: 'paragraph', spans: [plainSpan('')] }]
}

function pushProse (blocks, text, usernames) {
  // The line breaks either side of a fence belong to the fence.
  const prose = text.replace(/^\n/, '').replace(/\n$/, '')
  if (!prose.trim()) return

  let paragraph = []
  const flush = () => {
    if (paragraph.length === 0) return
    blocks.push({ type: 'paragraph', spans: formatPeerChatInline(paragraph.join('\n'), usernames) })
    paragraph = []
  }
  for (const line of prose.split('\n')) {
    const heading = line.match(HEADING)
    if (!heading) {
      paragraph.push(line)
      continue
    }
    flush()
    blocks.push({ type: 'heading', level: heading[1].length, spans: formatPeerChatInline(heading[2], usernames) })
  }
  flush()
}

/** One line or paragraph as runs of text with their styles. */
export function formatPeerChatInline (text, usernames) {
  const atoms = findAtoms(text, usernames)

  // What the emphasis patterns search: every atom stands in as letters, so a
  // star inside a link or a code span can never open or close anything.
  let masked = text
  for (const atom of atoms) {
    masked = masked.slice(0, atom.start) + 'a'.repeat(atom.end - atom.start) + masked.slice(atom.end)
  }

  const markers = new Set()
  const styles = Array.from({ length: text.length }, () => ({ bold: false, italic: false, strike: false }))
  const apply = (pattern, style, prefix, width) => {
    for (const match of masked.matchAll(pattern)) {
      const start = match.index + (prefix ? match[1].length : 0)
      const end = match.index + match[0].length
      for (let index = start; index < start + width; index++) markers.add(index)
      for (let index = end - width; index < end; index++) markers.add(index)
      for (let index = start + width; index < end - width; index++) styles[index][style] = true
    }
    // Used markers stop counting, so ** is not read again as two *.
    for (const index of markers) masked = masked.slice(0, index) + '\u0001' + masked.slice(index + 1)
  }
  apply(BOLD, 'bold', false, 2)
  apply(STAR_ITALIC, 'italic', true, 1)
  apply(UNDERSCORE_ITALIC, 'italic', true, 1)
  apply(STRIKE, 'strike', true, 1)

  const spans = []
  const push = (span) => {
    const last = spans.at(-1)
    if (last && !last.code && !last.link && !last.mention && !span.code && !span.link && !span.mention &&
      last.bold === span.bold && last.italic === span.italic && last.strike === span.strike) {
      last.text += span.text
      return
    }
    spans.push(span)
  }

  let index = 0
  let atom = 0
  while (index < text.length) {
    if (atoms[atom]?.start === index) {
      const { end, kind, value } = atoms[atom]
      push({
        ...styles[index],
        code: kind === 'code',
        link: kind === 'link' ? value : null,
        mention: kind === 'mention',
        text: kind === 'code' ? text.slice(index + 1, end - 1) : text.slice(index, end)
      })
      index = end
      atom++
      continue
    }
    if (!markers.has(index)) push({ ...plainSpan(text[index]), ...styles[index] })
    index++
  }

  return spans.length > 0 ? spans : [plainSpan('')]
}

// Code spans, links and mentions: runs that are taken whole.
function findAtoms (text, usernames) {
  const atoms = []
  let cursor = 0
  const between = (start, end) => {
    let offset = start
    for (const part of splitPeerChatMessageParts(text.slice(start, end), usernames)) {
      if (part.link || part.mention) {
        atoms.push({ start: offset, end: offset + part.text.length, kind: part.link ? 'link' : 'mention', value: part.link })
      }
      offset += part.text.length
    }
  }
  for (const match of text.matchAll(INLINE_CODE)) {
    between(cursor, match.index)
    atoms.push({ start: match.index, end: match.index + match[0].length, kind: 'code', value: null })
    cursor = match.index + match[0].length
  }
  between(cursor, text.length)
  return atoms.sort((left, right) => left.start - right.start)
}

function plainSpan (text) {
  return { text, bold: false, italic: false, strike: false, code: false, link: null, mention: false }
}
