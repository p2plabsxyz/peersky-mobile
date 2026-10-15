// A copy of the phone's app/i18n/plural.mjs (peersky-mobile). Keep the two alike.
// Which form of a word goes with a count, by language. The rules are CLDR's,
// for whole numbers, which is all the app ever counts. A catalog holds one
// form for each category its language has; English has one and other.

const ONE_OTHER = ['one', 'other']
const OTHER = ['other']
const SLAVIC = ['one', 'few', 'many', 'other']

export const PLURAL_CATEGORIES = Object.freeze({
  en: ONE_OTHER,
  es: ONE_OTHER,
  'pt-BR': ONE_OTHER,
  fr: ONE_OTHER,
  de: ONE_OTHER,
  it: ONE_OTHER,
  nl: ONE_OTHER,
  pl: SLAVIC,
  ru: SLAVIC,
  uk: SLAVIC,
  tr: ONE_OTHER,
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
  fa: ONE_OTHER,
  ur: ONE_OTHER,
  hi: ONE_OTHER,
  mr: ONE_OTHER,
  // Sanskrit has a dual as well as a plural. CLDR has no rule for it.
  sa: ['one', 'two', 'other'],
  bn: ONE_OTHER,
  id: OTHER,
  vi: OTHER,
  th: OTHER,
  ja: OTHER,
  ko: OTHER,
  'zh-Hans': OTHER,
  'zh-Hant': OTHER
})

/** The category of count in this language: one of PLURAL_CATEGORIES[code]. */
export function pluralCategory (code, count) {
  const n = Math.abs(Math.trunc(Number(count) || 0))
  const mod10 = n % 10
  const mod100 = n % 100
  switch (code) {
    case 'id': case 'vi': case 'th': case 'ja': case 'ko': case 'zh-Hans': case 'zh-Hant':
      return 'other'
    // Zero takes the singular too.
    case 'fr': case 'pt-BR': case 'fa': case 'hi': case 'bn':
      return n <= 1 ? 'one' : 'other'
    case 'ru': case 'uk':
      if (mod10 === 1 && mod100 !== 11) return 'one'
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
      return 'many'
    case 'pl':
      if (n === 1) return 'one'
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
      return 'many'
    case 'ar':
      if (n === 0) return 'zero'
      if (n === 1) return 'one'
      if (n === 2) return 'two'
      if (mod100 >= 3 && mod100 <= 10) return 'few'
      if (mod100 >= 11) return 'many'
      return 'other'
    case 'sa':
      if (n === 1) return 'one'
      if (n === 2) return 'two'
      return 'other'
    default:
      return n === 1 ? 'one' : 'other'
  }
}
