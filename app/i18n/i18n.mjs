import { SOURCE_LANGUAGE, isLanguageCode } from './languages.mjs'
import { pluralCategory } from './plural.mjs'

// The text on PeerSky's own screens, in the language picked.
//
// The English text is the key, the way gettext does it, so the code reads as
// what it shows: t('Remove {name}?', { name }). A catalog maps that text to
// the language's own, and anything a catalog lacks shows in English.
//
// Plain JavaScript with no React Native in it, so the helpers that build text
// run the same in the app and under node tests. The app registers its
// catalogs at start (setup.ts); without them every t() gives English back.

let language = SOURCE_LANGUAGE
let catalog = null
let version = 0
const loaders = new Map()
const listeners = new Set()

/** Each language's catalog, loaded only once it is picked. */
export function registerCatalogs (map) {
  for (const [code, load] of Object.entries(map || {})) {
    if (isLanguageCode(code) && typeof load === 'function') loaders.set(code, load)
  }
}

/** Switches every screen to this language. Anything else means English. */
export function setLanguage (code) {
  const next = isLanguageCode(code) ? code : SOURCE_LANGUAGE
  let nextCatalog = null
  if (next !== SOURCE_LANGUAGE) {
    try {
      nextCatalog = loaders.get(next)?.() || null
    } catch {
      nextCatalog = null
    }
  }
  if (next === language && nextCatalog === catalog) return
  language = next
  catalog = nextCatalog && typeof nextCatalog === 'object' ? nextCatalog : null
  version += 1
  for (const listener of listeners) {
    try {
      listener()
    } catch {}
  }
}

export function getLanguage () {
  return language
}

// Moves on with every switch, for React to re-render on (useT.ts).
export function getLanguageVersion () {
  return version
}

export function subscribeLanguage (listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * This English text in the language picked, with each {name} filled in.
 * @param {string} text
 * @param {Record<string, string | number>} [values]
 */
export function t (text, values) {
  const entry = catalog?.[text]
  const translated = typeof entry === 'string' && entry ? entry : text
  return values ? fill(translated, values) : translated
}

/**
 * Marks English text for translation without translating it, for a table
 * defined when a file loads, before anybody has picked a language: a list of
 * pages, a menu. Whatever shows it calls tKey() on it then.
 * @param {string} text
 */
export function msg (text) {
  return text
}

/**
 * t() for text that comes from a variable: text marked with msg() where it was
 * written. scripts/i18n.mjs gathers msg() text, so the catalogs have it.
 * @param {string} text
 * @param {Record<string, string | number>} [values]
 */
export function tKey (text, values) {
  return t(text, values)
}

/**
 * Text with a count in it, in the form the count takes in the language
 * picked: tp({ one: '{count} peer', other: '{count} peers' }, n). A catalog
 * keeps the forms under the English `other`.
 * @param {{ one: string, other: string }} forms
 * @param {number} count
 * @param {Record<string, string | number>} [values]
 */
export function tp (forms, count, values) {
  const entry = catalog?.[forms.other]
  let text = ''
  if (entry && typeof entry === 'object') {
    text = entry[pluralCategory(language, count)] || entry.other || ''
  }
  if (!text) text = pluralCategory('en', count) === 'one' ? forms.one : forms.other
  return fill(text, { count, ...values })
}

/**
 * What the catalog of the language picked has for these keys, as it has it:
 * a string, or a plural's forms. For a page that translates itself with the
 * app's catalogs, the Hyperdrive viewer, which is handed these and nothing
 * else. Keys the catalog lacks are left out, so English is empty.
 * @param {string[]} keys
 */
export function catalogEntries (keys) {
  const entries = {}
  if (!catalog) return entries
  for (const key of keys || []) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(catalog, key)) continue
    const entry = catalog[key]
    if (typeof entry === 'string' && entry) {
      entries[key] = entry
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const forms = {}
      for (const [category, text] of Object.entries(entry)) {
        if (typeof text === 'string' && text) forms[category] = text
      }
      if (Object.keys(forms).length) entries[key] = forms
    }
  }
  return entries
}

function fill (text, values) {
  return String(text).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  )
}
