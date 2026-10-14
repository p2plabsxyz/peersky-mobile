// Written by scripts/i18n.mjs from LANGUAGES in languages.mjs. Each catalog is
// required only when its language is picked, so the others are never parsed.
export const CATALOG_LOADERS: Record<string, () => unknown> = {
  es: () => require('./locales/es.json'),
  'pt-BR': () => require('./locales/pt-BR.json'),
  fr: () => require('./locales/fr.json'),
  de: () => require('./locales/de.json'),
  it: () => require('./locales/it.json'),
  nl: () => require('./locales/nl.json'),
  pl: () => require('./locales/pl.json'),
  ru: () => require('./locales/ru.json'),
  uk: () => require('./locales/uk.json'),
  tr: () => require('./locales/tr.json'),
  ar: () => require('./locales/ar.json'),
  fa: () => require('./locales/fa.json'),
  ur: () => require('./locales/ur.json'),
  hi: () => require('./locales/hi.json'),
  mr: () => require('./locales/mr.json'),
  sa: () => require('./locales/sa.json'),
  bn: () => require('./locales/bn.json'),
  id: () => require('./locales/id.json'),
  vi: () => require('./locales/vi.json'),
  th: () => require('./locales/th.json'),
  ja: () => require('./locales/ja.json'),
  ko: () => require('./locales/ko.json'),
  'zh-Hans': () => require('./locales/zh-Hans.json'),
  'zh-Hant': () => require('./locales/zh-Hant.json')
}
