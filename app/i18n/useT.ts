import { useSyncExternalStore } from 'react'
import { getLanguageVersion, subscribeLanguage, t } from './i18n.mjs'

// The t() a screen calls. It also re-renders the screen when the language
// changes, so text switches without a restart. Code outside a component calls
// t() from i18n.mjs, and reads the language in force at that moment.
export function useT () {
  useSyncExternalStore(subscribeLanguage, getLanguageVersion)
  return t
}
