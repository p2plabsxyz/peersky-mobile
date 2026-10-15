/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { pluralCategory } from '/hyperdrive/viewer/lib/plural.js'

// The viewer's words in the language PeerSky shows, the way the phone's
// app/i18n/i18n.mjs does it: the English text is the key, {name} fills a
// value in, a missing translation shows the English, and plurals take the
// form pluralCategory() picks for the language.
//
// The phone's scanner reads every call of t, tp and msg in the viewer's
// files, comments included, so each call names its English text as one
// plain string literal on one line, never pieced together with +, and no
// comment spells out a call. Text that comes from a table is marked with
// msg where it is written and shown with tKey.
//
// Numbers, sizes, dates and names of countries and languages come from Intl
// in the same language. A photo's time is a wall-clock time kept as
// Date.UTC(...) of that time, so it is formatted with timeZone 'UTC'.

const RTL = new Set(['ar', 'fa', 'ur', 'he', 'yi', 'ps', 'sd', 'ug', 'dv'])

let language = 'en'
let catalog = {}
const formats = new Map()

/** Sets the language and its catalog: { english: translation, ... }. */
export function setupI18n ({ language: code, strings } = {}) {
  language = typeof code === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(code) ? code : 'en'
  catalog = strings && typeof strings === 'object' ? strings : {}
  formats.clear()
}

export function getLanguage () {
  return language
}

/** 'rtl' for a language written right to left. */
export function textDirection (code = language) {
  return RTL.has(String(code).split('-')[0].toLowerCase()) ? 'rtl' : 'ltr'
}

function fill (text, values) {
  return String(text).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  )
}

function translate (text, values) {
  const entry = catalog[text]
  const translated = typeof entry === 'string' && entry ? entry : text
  return values ? fill(translated, values) : translated
}

/**
 * This English text in the language picked, with each {name} filled in.
 * @param {string} text
 * @param {Record<string, string | number>} [values]
 */
export function t (text, values) {
  return translate(text, values)
}

/**
 * Text with a count in it, in the form the count takes in the language:
 * forms is the English one and other, each with {count}, which is filled
 * with the number formatted for the language.
 * @param {{ one: string, other: string }} forms
 * @param {number} count
 * @param {Record<string, string | number>} [values]
 */
export function tp (forms, count, values) {
  const entry = catalog[forms.other]
  let text = ''
  if (entry && typeof entry === 'object') {
    text = entry[pluralCategory(language, count)] || entry.other || ''
  }
  if (!text) text = pluralCategory('en', count) === 'one' ? forms.one : forms.other
  return fill(text, { count: formatNumber(count), ...values })
}

/** Marks text for translation where a table is written; tKey shows it. */
export function msg (text) {
  return text
}

/** Like t, for text held in a variable, marked with msg where it was written. */
export function tKey (text, values) {
  return translate(text, values)
}

function cached (kind, options, make) {
  const key = kind + JSON.stringify(options)
  let value = formats.get(key)
  if (!value) {
    try {
      value = make(language, options)
    } catch {
      value = make('en', options)
    }
    formats.set(key, value)
  }
  return value
}

export function formatNumber (value, options = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return cached('n', options, (code, opts) => new Intl.NumberFormat(code, opts)).format(number)
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']

/** 1234567 to '1.2 MB'. */
export function formatBytes (bytes) {
  let value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1000) return tp({ one: '{count} byte', other: '{count} bytes' }, value)
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  try {
    return formatNumber(value, { style: 'unit', unit: BYTE_UNITS[unit], unitDisplay: 'short', maximumFractionDigits: digits })
  } catch {
    return `${value.toFixed(digits)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
  }
}

/** Seconds to '4:05' or '1:02:03'. */
export function formatDuration (seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** Seconds to '1 h 52 min' or '24 min', for a title's length. */
export function formatRuntime (seconds) {
  const minutes = Math.round((Number(seconds) || 0) / 60)
  if (minutes < 1) return formatDuration(seconds)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  try {
    if (!h) return formatNumber(m, { style: 'unit', unit: 'minute', unitDisplay: 'short' })
    const hours = formatNumber(h, { style: 'unit', unit: 'hour', unitDisplay: 'short' })
    return m ? `${hours} ${formatNumber(m, { style: 'unit', unit: 'minute', unitDisplay: 'short' })}` : hours
  } catch {
    return formatDuration(seconds)
  }
}

function dateFormat (options) {
  return cached('d', options, (code, opts) => new Intl.DateTimeFormat(code, opts))
}

/**
 * A date as text. `utc: true` for a wall-clock time kept as Date.UTC(...),
 * such as a photo's; otherwise the time is shown in this device's zone.
 * style: 'date' (14 Oct 2026), 'datetime', 'time', 'month' (October 2026),
 * 'day' (Tuesday, 14 October), 'short' (14/10/2026).
 */
export function formatDate (ms, { utc = false, style = 'date' } = {}) {
  const value = Number(ms)
  if (!Number.isFinite(value)) return ''
  const zone = utc ? { timeZone: 'UTC' } : {}
  const options = {
    date: { year: 'numeric', month: 'short', day: 'numeric' },
    datetime: { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    time: { hour: 'numeric', minute: '2-digit' },
    month: { year: 'numeric', month: 'long' },
    day: { weekday: 'long', month: 'long', day: 'numeric' },
    dayYear: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
    short: { year: 'numeric', month: 'numeric', day: 'numeric' }
  }[style] || { year: 'numeric', month: 'short', day: 'numeric' }
  try {
    return dateFormat({ ...options, ...zone }).format(new Date(value))
  } catch {
    return new Date(value).toISOString().slice(0, 10)
  }
}

/** 'Yesterday', '3 days ago' and such, for a real instant. */
export function formatRelative (ms) {
  const value = Number(ms)
  if (!Number.isFinite(value)) return ''
  const diff = (value - Date.now()) / 1000
  const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']]
  const sizes = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 }
  for (const [limit, unit] of steps) {
    if (Math.abs(diff) < limit) {
      try {
        return cached('r', { numeric: 'auto' }, (code, opts) => new Intl.RelativeTimeFormat(code, opts))
          .format(Math.round(diff / sizes[unit]), unit)
      } catch {
        return formatDate(value)
      }
    }
  }
  return formatDate(value)
}

function displayNames (type) {
  return cached('names', { type }, (code, opts) => new Intl.DisplayNames([code], opts))
}

/** 'IN' to 'India', in the language picked. */
export function regionName (code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/.test(code)) return ''
  try {
    return displayNames('region').of(code.toUpperCase()) || code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

/** 'en' to 'English', in the language picked. */
export function languageName (code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(code)) return ''
  try {
    const name = displayNames('language').of(code)
    return name ? name.charAt(0).toLocaleUpperCase(language) + name.slice(1) : code
  } catch {
    return code
  }
}

/** ['a', 'b', 'c'] to 'a, b and c'. */
export function formatList (items) {
  const list = items.filter(Boolean).map(String)
  try {
    return cached('l', { style: 'long', type: 'conjunction' }, (code, opts) => new Intl.ListFormat(code, opts)).format(list)
  } catch {
    return list.join(', ')
  }
}

/** Compares two names the way people sort them, numbers by value. */
export function compareText (a, b) {
  return cached('c', { numeric: true, sensitivity: 'base' }, (code, opts) => new Intl.Collator(code, opts)).compare(a, b)
}
