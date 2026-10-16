// The languages PeerSky's own screens come in. English is what the code is
// written in, so it has no catalog: every other one is a file in ./locales
// named by its code, holding the English text and its translation.
//
// The codes are BCP 47 tags, the form iOS (`<code>.lproj`) and Android
// (`locales_config.xml`) take as they are.
export const SOURCE_LANGUAGE = 'en'

export const LANGUAGES = Object.freeze([
  { code: 'en', name: 'English', native: 'English', rtl: false },
  { code: 'es', name: 'Spanish', native: 'Español', rtl: false },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', native: 'Português (Brasil)', rtl: false },
  { code: 'fr', name: 'French', native: 'Français', rtl: false },
  { code: 'de', name: 'German', native: 'Deutsch', rtl: false },
  { code: 'it', name: 'Italian', native: 'Italiano', rtl: false },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', rtl: false },
  { code: 'pl', name: 'Polish', native: 'Polski', rtl: false },
  { code: 'ru', name: 'Russian', native: 'Русский', rtl: false },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', rtl: false },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', rtl: false },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', rtl: true },
  { code: 'ur', name: 'Urdu', native: 'اردو', rtl: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', rtl: false },
  { code: 'mr', name: 'Marathi', native: 'मराठी', rtl: false },
  { code: 'sa', name: 'Sanskrit', native: 'संस्कृतम्', rtl: false },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', rtl: false },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', rtl: false },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', rtl: false },
  { code: 'th', name: 'Thai', native: 'ไทย', rtl: false },
  { code: 'ja', name: 'Japanese', native: '日本語', rtl: false },
  { code: 'ko', name: 'Korean', native: '한국어', rtl: false },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', native: '简体中文', rtl: false },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文', rtl: false }
])

export const LANGUAGE_CODES = Object.freeze(LANGUAGES.map((language) => language.code))

// The setting that follows the phone's language rather than naming one.
export const SYSTEM_LANGUAGE = 'system'

export function isLanguageCode (value) {
  return typeof value === 'string' && LANGUAGE_CODES.includes(value)
}

export function isRtlLanguage (code) {
  return LANGUAGES.some((language) => language.code === code && language.rtl)
}

export function languageNamed (code) {
  return LANGUAGES.find((language) => language.code === code) || null
}

// Chinese is two languages here by its script, and a phone says which one
// either by the script or by the place.
const TRADITIONAL_CHINESE_REGIONS = new Set(['tw', 'hk', 'mo'])

/**
 * The first of these language tags PeerSky has, in the order given, or
 * English. Takes what phones hand over: `mr-IN`, `pt_BR`, `zh-Hant-TW`, and
 * Android's `zh_CN_#Hans`.
 * @param {string[]} tags
 */
export function matchLanguage (tags) {
  for (const raw of Array.isArray(tags) ? tags : []) {
    const code = matchTag(raw)
    if (code) return code
  }
  return SOURCE_LANGUAGE
}

function matchTag (raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const parts = raw.trim().replace(/_#?/g, '-').replace(/#/g, '').toLowerCase().split('-').filter(Boolean)
  const [primary, ...rest] = parts
  if (primary === 'zh') {
    if (rest.includes('hant')) return 'zh-Hant'
    if (rest.includes('hans')) return 'zh-Hans'
    return rest.some((part) => TRADITIONAL_CHINESE_REGIONS.has(part)) ? 'zh-Hant' : 'zh-Hans'
  }
  // Java's old code for Indonesian.
  if (primary === 'in') return 'id'
  // One Portuguese, the one most people reading it here speak.
  if (primary === 'pt') return 'pt-BR'
  return LANGUAGE_CODES.find((code) => code.toLowerCase() === primary) || null
}
