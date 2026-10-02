import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

import { convertFilterListToWebKitRules } from '../../app/privacy/webkit-content-rules.mjs'

// Cover Your Tracks, linked from Settings, Privacy, asks two things about
// blocking. Its test page loads a hidden iframe for each, and answers Yes only
// when that frame never loads:
//   "Is your browser blocking tracking ads?"      trackersimulator.org
//   "Is your browser blocking invisible trackers?" eviltracker.net
// These are the exact requests it makes, from coveryourtracks.eff.org/kcarter.
const TEST_PAGE = 'https://coveryourtracks.eff.org/kcarter?aat=1'
const QUESTIONS = [
  { question: 'Blocking tracking ads?', host: 'trackersimulator.org', frame: 'https://trackersimulator.org/kcarting-tally?&ad_url=424242' },
  { question: 'Blocking invisible trackers?', host: 'eviltracker.net', frame: 'https://eviltracker.net/kcarting-tally?&trackingserver=424242' }
]
const LISTS = ['easylist', 'easyprivacy']

function readList (name) {
  return readFile(new URL(`../../assets/content-blocking/${name}.txt`, import.meta.url), 'utf8')
}

function site (host) {
  return host.split('.').slice(-2).join('.')
}

function domainMatches (pattern, host) {
  if (pattern.startsWith('*')) {
    const domain = pattern.slice(1)
    return host === domain || host.endsWith(`.${domain}`)
  }
  return host === pattern
}

// What WebKit does with one compiled list: rules in order, the last one that
// matches decides, and an ignore-previous-rules undoes the blocks before it.
function webkitBlocks (rules, { url, type, page }) {
  const host = new URL(url).hostname
  const pageHost = new URL(page).hostname
  const party = site(host) === site(pageHost) ? 'first-party' : 'third-party'
  let blocked = false

  for (const { trigger, action } of rules) {
    if (!trigger['resource-type'].includes(type)) continue
    if (trigger['load-type'] && !trigger['load-type'].includes(party)) continue
    if (trigger['if-domain'] && !trigger['if-domain'].some((domain) => domainMatches(domain, pageHost))) continue
    if (trigger['unless-domain']?.some((domain) => domainMatches(domain, pageHost))) continue
    if (!new RegExp(trigger['url-filter'], 'i').test(url)) continue
    blocked = action.type === 'block'
  }
  return blocked
}

describe('Cover Your Tracks says Yes, Yes', () => {
  test('on iOS, the shipped lists block both of its tracker frames', async () => {
    const lists = await Promise.all(LISTS.map(async (name) => convertFilterListToWebKitRules(await readList(name))))
    // Each list is compiled and attached on its own, so either can block.
    const blocks = (request) => lists.some((rules) => webkitBlocks(rules, request))

    for (const { question, frame } of QUESTIONS) {
      assert.equal(blocks({ url: frame, type: 'document', page: TEST_PAGE }), true, `${question} would say No on iOS`)
    }

    // The test page itself, and a frame from its own site, still load.
    assert.equal(blocks({ url: TEST_PAGE, type: 'document', page: TEST_PAGE }), false)
    assert.equal(blocks({ url: 'https://coveryourtracks.eff.org/static/frame.html', type: 'document', page: TEST_PAGE }), false)
  })

  // Android hands each frame request to adblock-rust. A bare ||host^ filter
  // there blocks every request to the host, of any type and from any page, so
  // the answer rests on the lists carrying one and nothing allowing it back.
  test('on Android, the shipped lists block both hosts outright', async () => {
    const contents = (await Promise.all(LISTS.map(readList))).join('\n')
    const lines = contents.split(/\r?\n/).map((line) => line.trim())

    for (const { question, host } of QUESTIONS) {
      assert.ok(lines.includes(`||${host}^`), `${question} would say No on Android: no ||${host}^ filter`)
      const allowed = lines.filter((line) => line.startsWith('@@') && line.toLowerCase().includes(host))
      assert.deepEqual(allowed, [], `${question} would say No on Android: an exception lets ${host} through`)
    }
  })

  test('on Android, frames reach the blocker as frames', async () => {
    const client = await readFile(new URL('../../plugins/templates/PeerSkyWebViewClient.kt.template', import.meta.url), 'utf8')

    // Only the page itself is let through unchecked.
    assert.match(client, /if \(request\.isForMainFrame\) return false/)
    assert.match(client, /if \(accept\.startsWith\("text\/html"\)\) return "subdocument"/)
  })
})
