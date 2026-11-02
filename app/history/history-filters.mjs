import { getLanguage, t } from '../i18n/i18n.mjs'

// What the History screen does with the list: finds pages by their words,
// shows them by the day they were visited on, and clears a stretch of time.

export const MAX_BROWSER_HISTORY_QUERY_LENGTH = 200
const HOUR_MS = 60 * 60 * 1000

/**
 * The pages whose title or address has every word typed, in any order. An
 * address is read as it shows too, so "café" finds a page whose address has
 * caf%C3%A9 in it.
 */
export function searchBrowserHistory (items, query) {
  const words = getQueryWords(query)
  if (words.length === 0) return items

  return items.filter((item) => {
    const text = `${item.title}\n${item.url}\n${getReadableUrl(item.url)}`.toLocaleLowerCase()
    return words.every((word) => text.includes(word))
  })
}

/** The start of the day `time` is on, by this phone's clock. */
export function getBrowserHistoryDayStart (time) {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * History by the day it was visited, newest first: each day's start, its
 * stretch of time and its pages, newest first.
 */
export function groupBrowserHistoryByDay (items) {
  const days = []
  let day = null
  for (const item of [...items].sort((a, b) => b.visitedAt - a.visitedAt)) {
    const from = getBrowserHistoryDayStart(item.visitedAt)
    if (day?.from !== from) {
      day = { key: String(from), from, to: shiftDay(from, 1), items: [] }
      days.push(day)
    }
    day.items.push(item)
  }
  return days
}

/** Today, Yesterday, or the day's date: Sat, Oct 31. */
export function formatBrowserHistoryDay (from, now = Date.now()) {
  const today = getBrowserHistoryDayStart(now)
  if (from === today) return t('Today')
  if (from === shiftDay(today, -1)) return t('Yesterday')

  const date = new Date(from)
  const options = { weekday: 'short', month: 'short', day: 'numeric' }
  if (date.getFullYear() !== new Date(now).getFullYear()) options.year = 'numeric'
  return formatDate(date, options)
}

/** The time of day a page was visited: 3:42 PM. */
export function formatBrowserHistoryTime (time) {
  return formatDate(new Date(time), { hour: 'numeric', minute: '2-digit' }, true)
}

// The choices the trash button gives. Each ends now, and takes in anything
// stamped later, from a clock that was set ahead.
export const BROWSER_HISTORY_CLEAR_RANGES = Object.freeze(['hour', 'today', 'two-days', 'all'])

/** The stretch of time a choice clears, or null for anything else. */
export function getBrowserHistoryClearRange (choice, now = Date.now()) {
  const today = getBrowserHistoryDayStart(now)
  if (choice === 'hour') return { from: now - HOUR_MS, to: Infinity }
  if (choice === 'today') return { from: today, to: Infinity }
  if (choice === 'two-days') return { from: shiftDay(today, -1), to: Infinity }
  if (choice === 'all') return { from: -Infinity, to: Infinity }
  return null
}

export function isInBrowserHistoryRange (time, range) {
  return typeof time === 'number' && !Number.isNaN(time) && time >= range.from && time < range.to
}

export function countBrowserHistoryRange (items, range) {
  let count = 0
  for (const item of items) if (isInBrowserHistoryRange(item.visitedAt, range)) count++
  return count
}

/** History without the pages visited in that time, the same list if none were. */
export function clearBrowserHistoryRange (items, range) {
  const kept = items.filter((item) => !isInBrowserHistoryRange(item.visitedAt, range))
  return kept.length === items.length ? items : kept
}

function getQueryWords (query) {
  if (typeof query !== 'string') return []
  return Array.from(query.trim())
    .slice(0, MAX_BROWSER_HISTORY_QUERY_LENGTH)
    .join('')
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

function getReadableUrl (url) {
  try {
    return decodeURIComponent(url.replace(/\+/g, ' '))
  } catch {
    return url
  }
}

// The day before or after, by the calendar, so a day that a clock change
// makes 23 or 25 hours long is still one day.
function shiftDay (from, days) {
  const date = new Date(from)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime()
}

// One formatter for each language and form, as a long list asks for the
// time of every page in it.
const formatters = new Map()

function formatDate (date, options, time = false) {
  try {
    const locales = getDateLocales()
    const key = `${locales.join()}\n${JSON.stringify(options)}`
    let formatter = formatters.get(key)
    if (!formatter) {
      if (formatters.size >= 16) formatters.clear()
      formatter = new Intl.DateTimeFormat(locales, options)
      formatters.set(key, formatter)
    }
    return formatter.format(date)
  } catch {
    return time ? date.toLocaleTimeString() : date.toLocaleDateString()
  }
}

// Dates in the language picked, as the phone writes them when it is in that
// language too: English on an English (UK) phone is 31 Oct, on 24 hours.
let phoneLocale = null

function getDateLocales () {
  const language = getLanguage()
  try {
    if (!phoneLocale) phoneLocale = Intl.DateTimeFormat().resolvedOptions().locale
    const code = language.toLowerCase()
    const phoneCode = phoneLocale.toLowerCase()
    if (phoneCode === code || phoneCode.startsWith(`${code}-`)) return [phoneLocale]
  } catch {}
  return [language]
}
