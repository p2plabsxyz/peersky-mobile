import { t } from './i18n.mjs'

// A language's name in the language shown now, for the language list. The
// names are not written out as t() calls anywhere, so scripts/i18n.mjs adds
// every name in LANGUAGES to the strings it gathers.
export function languageName (language) {
  return t(language.name)
}
