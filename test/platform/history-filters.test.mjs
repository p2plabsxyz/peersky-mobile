import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { setLanguage } from '../../app/i18n/i18n.mjs'
import {
  BROWSER_HISTORY_CLEAR_RANGES,
  clearBrowserHistoryRange,
  countBrowserHistoryRange,
  formatBrowserHistoryDay,
  formatBrowserHistoryTime,
  getBrowserHistoryClearRange,
  getBrowserHistoryDayStart,
  groupBrowserHistoryByDay,
  isInBrowserHistoryRange,
  MAX_BROWSER_HISTORY_QUERY_LENGTH,
  searchBrowserHistory
} from '../../app/history/history-filters.mjs'

// Days are the phone's, so the tests keep one clock: New York's, where
// Sunday, November 1 2026 is 25 hours long.
process.env.TZ = 'America/New_York'

const at = (month, day, hour = 12, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute).getTime()
const NOW = at(11, 2, 15, 42)
const page = (url, title, visitedAt) => ({ url, title, visitedAt })

const HISTORY = [
  page('https://m.youtube.com/watch?v=3nQNiWdeH2Q', 'NCS - Heroes Tonight', at(11, 2, 15, 30)),
  page('https://duckduckgo.com/?q=caf%C3%A9+near+me', 'café near me at DuckDuckGo', at(11, 2, 9, 5)),
  page('https://en.wikipedia.org/wiki/Peer-to-peer', 'Peer-to-peer - Wikipedia', at(11, 1, 23, 50)),
  page('hyper://blog.example/', 'A P2P blog', at(11, 1, 0, 10)),
  page('https://example.com/', 'Example', at(10, 31, 8)),
  page('https://old.example/', 'Last year', at(12, 30, 8, 0, 2025))
]

describe('history search', () => {
  test('finds pages with every word typed, in the title or the address, in any case', () => {
    const titles = (query) => searchBrowserHistory(HISTORY, query).map((item) => item.title)
    assert.deepEqual(titles('heroes ncs'), ['NCS - Heroes Tonight'])
    assert.deepEqual(titles('  WIKIPEDIA  '), ['Peer-to-peer - Wikipedia'])
    assert.deepEqual(titles('youtube.com'), ['NCS - Heroes Tonight'])
    assert.deepEqual(titles('hyper://'), ['A P2P blog'])
    assert.deepEqual(titles('peer heroes'), [])
    // A word split between the title and the address is no match.
    assert.deepEqual(titles('tonighthttps'), [])
  })

  test('reads an address as it shows, with its escapes undone', () => {
    assert.deepEqual(searchBrowserHistory(HISTORY, 'café near').map((item) => item.url), [
      'https://duckduckgo.com/?q=caf%C3%A9+near+me'
    ])
    const broken = [page('https://example.com/%E0%A4%A', 'Broken', 1)]
    assert.equal(searchBrowserHistory(broken, '%e0').length, 1)
  })

  test('nothing typed is the whole list, and a long paste is cut short', () => {
    assert.equal(searchBrowserHistory(HISTORY, ''), HISTORY)
    assert.equal(searchBrowserHistory(HISTORY, '   '), HISTORY)
    assert.equal(searchBrowserHistory(HISTORY, null), HISTORY)
    const long = `heroes ${'x'.repeat(MAX_BROWSER_HISTORY_QUERY_LENGTH * 4)}`
    assert.deepEqual(searchBrowserHistory(HISTORY, long), [])
    const cut = `${'a'.repeat(MAX_BROWSER_HISTORY_QUERY_LENGTH)}zzz`
    const match = [page('https://example.com/', 'a'.repeat(MAX_BROWSER_HISTORY_QUERY_LENGTH), 1)]
    assert.equal(searchBrowserHistory(match, cut).length, 1)
  })
})

describe('history by day', () => {
  test('groups pages by the day on this phone\'s clock, newest first', () => {
    const shuffled = [HISTORY[3], HISTORY[0], HISTORY[5], HISTORY[2], HISTORY[4], HISTORY[1]]
    const days = groupBrowserHistoryByDay(shuffled)
    assert.deepEqual(days.map((day) => day.items.map((item) => item.title)), [
      ['NCS - Heroes Tonight', 'café near me at DuckDuckGo'],
      ['Peer-to-peer - Wikipedia', 'A P2P blog'],
      ['Example'],
      ['Last year']
    ])
    assert.equal(days[0].from, at(11, 2, 0))
    assert.equal(days[0].to, at(11, 3, 0))
    // November 1 is 25 hours long here, and still one day.
    assert.equal(days[1].from, at(11, 1, 0))
    assert.equal(days[1].to - days[1].from, 25 * 60 * 60 * 1000)
    assert.equal(days[1].to, days[0].from)
    assert.equal(new Set(days.map((day) => day.key)).size, days.length)
  })

  test('names today and yesterday, and dates the rest, with the year when it is another', () => {
    assert.equal(formatBrowserHistoryDay(getBrowserHistoryDayStart(NOW), NOW), 'Today')
    assert.equal(formatBrowserHistoryDay(at(11, 1, 0), NOW), 'Yesterday')
    const october = formatBrowserHistoryDay(at(10, 31, 0), NOW)
    assert.match(october, /31/)
    assert.doesNotMatch(october, /2026/)
    assert.match(formatBrowserHistoryDay(at(12, 30, 0, 0, 2025), NOW), /2025/)
    // Yesterday at a year's turn.
    assert.equal(formatBrowserHistoryDay(at(12, 31, 0, 0, 2025), at(1, 1, 9)), 'Yesterday')
    assert.match(formatBrowserHistoryTime(at(11, 2, 15, 42)), /42/)
  })

  test('dates are in the language picked', () => {
    setLanguage('de')
    try {
      assert.match(formatBrowserHistoryDay(at(10, 31, 0), NOW), /Okt/)
    } finally {
      setLanguage('en')
    }
  })
})

describe('clearing a stretch of history', () => {
  test('each choice clears up to now, and anything stamped later', () => {
    const titlesKept = (choice) => clearBrowserHistoryRange(HISTORY, getBrowserHistoryClearRange(choice, NOW))
      .map((item) => item.title)
    assert.deepEqual(BROWSER_HISTORY_CLEAR_RANGES, ['hour', 'today', 'two-days', 'all'])

    assert.deepEqual(titlesKept('hour'), HISTORY.slice(1).map((item) => item.title))
    assert.deepEqual(titlesKept('today'), HISTORY.slice(2).map((item) => item.title))
    assert.deepEqual(titlesKept('two-days'), ['Example', 'Last year'])
    assert.deepEqual(titlesKept('all'), [])

    const ahead = [page('https://example.com/later', 'Later', NOW + 86_400_000)]
    assert.deepEqual(clearBrowserHistoryRange(ahead, getBrowserHistoryClearRange('hour', NOW)), [])
    assert.equal(getBrowserHistoryClearRange('week', NOW), null)
  })

  test('a day clears that day alone, and nothing cleared is the same list', () => {
    const [, yesterday] = groupBrowserHistoryByDay(HISTORY)
    assert.deepEqual(clearBrowserHistoryRange(HISTORY, yesterday).map((item) => item.title), [
      'NCS - Heroes Tonight', 'café near me at DuckDuckGo', 'Example', 'Last year'
    ])
    const none = { from: at(6, 1, 0), to: at(6, 2, 0) }
    assert.equal(clearBrowserHistoryRange(HISTORY, none), HISTORY)
  })

  test('counts what a choice would clear, and takes only real times', () => {
    assert.equal(countBrowserHistoryRange(HISTORY, getBrowserHistoryClearRange('two-days', NOW)), 4)
    assert.equal(countBrowserHistoryRange([], getBrowserHistoryClearRange('all', NOW)), 0)
    const all = getBrowserHistoryClearRange('all', NOW)
    assert.equal(isInBrowserHistoryRange(0, all), true)
    assert.equal(isInBrowserHistoryRange(Number.NaN, all), false)
    assert.equal(isInBrowserHistoryRange('5', all), false)
    assert.equal(isInBrowserHistoryRange(undefined, all), false)
  })
})
