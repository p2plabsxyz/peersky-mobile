// What a list on the Hyperdrive screen shows: everything, only files or only
// folders, and the ones whose name has what was typed in the search box. The
// box comes up once the list holds more than SEARCH_AFTER, and stays while it
// has something typed in it. The Hyperdrive app in PeerSky Desktop follows the
// same rules (list-filter.js in the hyperdrive repo).

export const SEARCH_AFTER = 10
export const KINDS = Object.freeze(['all', 'file', 'folder'])

// Case and accents aside, so "resume" finds "Résumé.pdf" and "ÉTÉ" finds
// "été", in any language the name is in.
export function foldText (value) {
  return decompose(String(value ?? ''))
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .trim()
}

// An engine without Unicode normalization still finds names by case.
function decompose (text) {
  try {
    return text.normalize('NFKD')
  } catch {
    return text
  }
}

export function kindOf (value) {
  return KINDS.includes(value) ? value : 'all'
}

/**
 * Whether one item stays in view. `item.kind` is 'file' or 'folder'; an item
 * of neither kind, such as an upload still going or one that failed, is
 * always shown.
 */
export function itemMatches (item, { kind = 'all', query = '' } = {}) {
  const itemKind = item?.kind
  if (itemKind !== 'file' && itemKind !== 'folder') return true
  const wanted = kindOf(kind)
  if (wanted !== 'all' && itemKind !== wanted) return false
  const words = foldText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const name = foldText(item.name)
  return words.every((word) => name.includes(word))
}

/** Whether the search box shows, for this many files and folders. */
export function showsSearch (count, query = '') {
  return count > SEARCH_AFTER || foldText(query) !== ''
}
