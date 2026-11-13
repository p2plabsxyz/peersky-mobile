import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'
import {
  MAX_WEBKIT_RULES_PER_LIST,
  collectWebKitExceptions,
  collectWebKitExceptionsAsync,
  convertFilterListToWebKitRules,
  convertFilterListToWebKitRulesAsync,
  convertFilterListsToWebKitRules,
  serializeWebKitContentRuleChunks,
  serializeWebKitContentRules,
  WEBKIT_RULE_FORMAT_VERSION
} from '../../app/privacy/webkit-content-rules.mjs'

const require = createRequire(import.meta.url)
const plugin = require('../../plugins/with-browser-downloads')

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

// The longest run of plain characters in a url-filter. Any address the
// filter matches has it, so most filters are passed over without a RegExp.
function literalOf (filter) {
  let longest = ''
  let run = ''
  const end = () => {
    if (run.length > longest.length) longest = run
    run = ''
  }
  for (let index = 0; index < filter.length; index++) {
    const character = filter[index]
    if (character === '\\') {
      run += filter[++index] || ''
    } else if (character === '[' || character === '(') {
      end()
      const close = character === '[' ? ']' : ')'
      while (index < filter.length && filter[index] !== close) index += filter[index] === '\\' ? 2 : 1
    } else if ('.*+?^$|)]{}'.includes(character)) {
      end()
    } else {
      run += character
    }
  }
  end()
  return longest.toLowerCase()
}

const filters = new WeakMap()

// What WebKit does with one compiled list: rules in order, and an
// ignore-previous-rules undoes the blocks before it, in that list only.
function webkitBlocks (rules, { url, type, page }) {
  const host = new URL(url).hostname
  const pageHost = new URL(page).hostname
  const party = site(host) === site(pageHost) ? 'first-party' : 'third-party'
  const address = url.toLowerCase()
  let blocked = false

  for (const rule of rules) {
    const { trigger, action } = rule
    if (!trigger['resource-type'].includes(type)) continue
    if (trigger['load-type'] && !trigger['load-type'].includes(party)) continue
    if (trigger['if-domain'] && !trigger['if-domain'].some((domain) => domainMatches(domain, pageHost))) continue
    if (trigger['unless-domain']?.some((domain) => domainMatches(domain, pageHost))) continue
    let filter = filters.get(rule)
    if (!filter) {
      filter = { literal: literalOf(trigger['url-filter']), source: trigger['url-filter'], regex: null }
      filters.set(rule, filter)
    }
    if (filter.literal && !address.includes(filter.literal)) continue
    filter.regex ||= new RegExp(filter.source, 'i')
    if (!filter.regex.test(url)) continue
    blocked = action.type === 'block'
  }
  return blocked
}

// Each list is compiled and attached on its own, so either one can block.
const blockedByAny = (lists, request) => lists.some((rules) => webkitBlocks(rules, request))

describe('iOS content blocking', () => {
  test('converts supported network filters without blocking documents', () => {
    const rules = convertFilterListToWebKitRules([
      '[Adblock Plus 2.0]',
      '! comment',
      '||ads.example^$third-party,script,image',
      '@@||ads.example/allowed.js$script',
      'example.com##.advert'
    ].join('\n'))

    assert.equal(rules.length, 2)
    assert.equal(rules[0].action.type, 'block')
    assert.deepEqual(rules[0].trigger['load-type'], ['third-party'])
    assert.deepEqual(rules[0].trigger['resource-type'], ['script', 'image'])
    assert.equal(rules[0].trigger['resource-type'].includes('document'), false)
    assert.equal(rules[1].action.type, 'ignore-previous-rules')
  })

  test('supports domains and safely skips unsupported modifiers and regex rules', () => {
    const rules = convertFilterListToWebKitRules([
      '||tracker.example^$domain=example.com|~private.example.com',
      '||unsafe.example^$redirect=noopjs',
      '/tracker-[0-9]+/'
    ].join('\n'))

    // The rule and its frame twin, both scoped to the same pages.
    assert.equal(rules.length, 2)
    for (const rule of rules) {
      assert.deepEqual(rule.trigger['if-domain'], ['*example.com'])
      assert.deepEqual(rule.trigger['unless-domain'], ['*private.example.com'])
    }
  })

  test('bounds output and keeps exceptions after blocking rules', () => {
    const rules = convertFilterListToWebKitRules([
      '@@||allow.example^$script',
      '||one.example^$script',
      '||two.example^$script'
    ].join('\n'), { maxRules: 2 })

    assert.equal(rules.length, 2)
    assert.equal(rules[0].action.type, 'block')
    assert.equal(rules[1].action.type, 'ignore-previous-rules')
    assert.doesNotThrow(() => JSON.parse(serializeWebKitContentRules('||ads.example^')))
  })

  test('converts and serializes up to the WebKit limit without monopolizing the event loop', async () => {
    const yields = []
    const contents = Array.from(
      { length: 45_001 },
      (_, index) => `||ads-${index}.example^`
    ).join('\n')
    const rules = await convertFilterListToWebKitRulesAsync(contents, {
      batchSize: 10_000,
      yieldControl: async () => yields.push('convert')
    })

    assert.equal(MAX_WEBKIT_RULES_PER_LIST, 150_000)
    // Each filter with no type also gets a rule for third-party frames.
    assert.equal(rules.length, 90_002)
    assert.equal(yields.length, 4)

    const chunks = await serializeWebKitContentRuleChunks(rules.slice(0, 3), {
      batchSize: 2,
      yieldControl: async () => yields.push('serialize')
    })
    assert.deepEqual(JSON.parse(`[${chunks.join(',')}]`), rules.slice(0, 3))
    assert.equal(yields.filter((event) => event === 'serialize').length, 2)
  })

  test('generates tracked native sources for compilation and WebView attachment', () => {
    assert.deepEqual(plugin.IOS_CONTENT_BLOCKING_SOURCES, [
      'PeerSkyContentBlocker.h',
      'PeerSkyContentBlocker.m',
      'BrowserContentBlockingModule.m',
      'PeerSkyWebViewManager.m'
    ])

    const blocker = require('node:fs').readFileSync(
      new URL('../../plugins/templates/PeerSkyContentBlocker.m.template', import.meta.url),
      'utf8'
    )
    const webView = require('node:fs').readFileSync(
      new URL('../../plugins/templates/PeerSkyWebViewManager.m.template', import.meta.url),
      'utf8'
    )
    const module = require('node:fs').readFileSync(
      new URL('../../plugins/templates/BrowserContentBlockingModule.m.template', import.meta.url),
      'utf8'
    )

    assert.match(blocker, /lookUpContentRuleListForIdentifier/)
    assert.match(blocker, /compileContentRuleListForIdentifier/)
    assert.match(blocker, /addContentRuleList/)
    assert.match(blocker, /getAvailableContentRuleListIdentifiers/)
    assert.match(blocker, /removeContentRuleListForIdentifier/)
    // WebKit calls the handler unchecked: a nil one crashed on every list update.
    assert.doesNotMatch(blocker, /completionHandler:nil/)
    assert.match(blocker, /self[.]ruleLists = \[compiled copy\]/)
    assert.match(blocker, /peersky-youtube-ad-break-v3/)
    assert.match(blocker, /youtubei\/v1\/player\/ad_break/)
    assert.match(blocker, /youtube-nocookie/)
    assert.doesNotMatch(blocker, /\(\?:/)
    // WebKit rejects any "|" in a url-filter, and one bad rule fails the list.
    const youtubeRules = /NSString \*json = @"(.*)";/.exec(blocker)?.[1]
    assert.ok(youtubeRules)
    assert.doesNotMatch(youtubeRules, /\|/)
    assert.match(blocker, /youtubeAdBlockingEnabled && youtubeRuleList/)
    assert.match(blocker, /if \(enabled\) \{\s*for \(WKContentRuleList \*ruleList in ruleLists\)/)
    assert.doesNotMatch(blocker, /if \(!enabled\) return;/)
    assert.match(blocker, /if \(error\) \{\s*completion\(error\);\s*return;/)
    assert.match(blocker, /instance[.]youtubeAdBlockingEnabled = YES;\s*\[instance ensureYoutubeRuleLoaded\]/)
    assert.match(blocker, /if \(enabled\) \[self ensureYoutubeRuleLoaded\]/)
    assert.doesNotMatch(
      blocker,
      /loadRuleAtIndex:[\s\S]*loadYoutubeRule:[\s\S]*removeStaleRuleListsKeepingSnapshot/
    )
    assert.match(webView, /<react-native-webview\/RNCWebViewImpl[.]h>/)
    assert.match(webView, /<react-native-webview\/RNCWebViewManager[.]h>/)
    assert.match(webView, /setUpWkWebViewConfig/)
    assert.match(webView, /RCT_EXPORT_MODULE\(PeerSkyWebView\)/)
    assert.match(module, /hasPrefix:allowedPrefix/)
    assert.match(module, /snapshot-\[0-9\]/)
    assert.match(module, /setYoutubeAdBlockingEnabled/)
  })

  // A trailing "^" was dropped, so a rule matched every URL that only started
  // with it: "||example.com/log^" blocked the images under example.com/logos/
  // too.
  test('a trailing separator means a separator or the end of the URL', () => {
    const matches = (filter, url) => convertFilterListToWebKitRules(filter)
      .some((rule) => new RegExp(rule.trigger['url-filter'], 'i').test(url))

    const log = '||example.com/log^$domain=~accounts.example.com'
    assert.equal(matches(log, 'https://www.example.com/logos/2026/banner-m.png'), false)
    assert.equal(matches(log, 'https://www.example.com/log?format=json'), true)
    assert.equal(matches(log, 'https://www.example.com/log'), true)
    assert.equal(matches(log, 'https://www.example.com/log/'), true)

    // A bare host: what follows it is the path or a port.
    const [host] = convertFilterListToWebKitRules('||ads.example^')
    assert.match(host.trigger['url-filter'], /\[\/:\]$/)
    for (const url of ['https://ads.example/x.js', 'https://ads.example:8443/', 'https://cdn.ads.example/']) {
      assert.equal(matches('||ads.example^', url), true, url)
    }
    for (const url of ['https://ads.example.org/', 'https://ads.examples.com/', 'https://site.com/ads.example/']) {
      assert.equal(matches('||ads.example^', url), false, url)
    }

    assert.equal(matches('/banner^', 'https://news.example/banner?size=1'), true)
    assert.equal(matches('/banner^', 'https://news.example/banner'), true)
    assert.equal(matches('/banner^', 'https://news.example/bannerads.png'), false)
    assert.equal(matches('|https://x.example/a^|', 'https://x.example/a/'), true)
    assert.equal(matches('|https://x.example/a^|', 'https://x.example/a/b'), false)

    // Still nothing WebKit refuses: no "|", and the separator inside a pattern
    // stays a character class.
    for (const filter of [log, '||ads.example^', '/banner^', '|https://x.example/a^|', '||a.example^b^']) {
      for (const rule of convertFilterListToWebKitRules(filter)) assert.doesNotMatch(rule.trigger['url-filter'], /\|/)
    }
  })

  // EasyPrivacy ships "*$ping,third-party". $ping has no WebKit equivalent, and
  // widening it to "raw" turned that one line into "block every third-party
  // fetch on every page", which is what stopped YouTube playing: the player
  // loaded, read the duration, then waited forever on media that comes from
  // googlevideo.com over fetch.
  // An iframe loads as a document, so rules that left documents out let every
  // tracker that comes in a frame through, including the two Cover Your Tracks
  // checks for.
  test('blocks third-party frames but never the page itself', () => {
    const [plain, frame] = convertFilterListToWebKitRules('||ads.example^')
    assert.equal(plain.trigger['resource-type'].includes('document'), false)
    assert.deepEqual(frame.trigger['resource-type'], ['document'])
    assert.deepEqual(frame.trigger['load-type'], ['third-party'])
    assert.equal(frame.trigger['url-filter'], plain.trigger['url-filter'])

    const subdocument = convertFilterListToWebKitRules('||frames.example^$subdocument,domain=news.example')
    assert.equal(subdocument.length, 1)
    assert.deepEqual(subdocument[0].trigger['resource-type'], ['document'])
    assert.deepEqual(subdocument[0].trigger['if-domain'], ['*news.example'])

    const exception = convertFilterListToWebKitRules('@@||widgets.example^')
    assert.deepEqual(exception.map((rule) => rule.action.type), ['ignore-previous-rules', 'ignore-previous-rules'])

    for (const typed of ['||ads.example^$script', '||ads.example^$~subdocument', '||ads.example^$first-party']) {
      const rules = convertFilterListToWebKitRules(typed)
      assert.equal(rules.some((rule) => rule.trigger['resource-type'].includes('document')), false, typed)
    }
  })

  test('skips $ping rather than widening it to every fetch', () => {
    const rules = convertFilterListToWebKitRules([
      '*$ping,third-party',
      '.com/hit$ping',
      '||tracker.example/beacon$ping,third-party'
    ].join('\n'))

    assert.deepEqual(rules, [])
  })

  test('the bundled lists never block an ordinary third-party fetch', async () => {
    const { readFile } = await import('node:fs/promises')

    for (const list of ['easylist', 'easyprivacy']) {
      const contents = await readFile(
        new URL(`../../assets/content-blocking/${list}.txt`, import.meta.url),
        'utf8'
      )
      const rules = convertFilterListToWebKitRules(contents)
      assert.ok(rules.length > 1000, `${list} produced too few rules`)

      // A url-filter that matches this matches everything, whatever it was
      // written to catch.
      const unrelated = 'https://media.example.org/stream/segment-00042.m4s'
      const overBroad = rules.filter((rule) =>
        rule.action.type === 'block' &&
        !rule.trigger['if-domain'] &&
        new RegExp(rule.trigger['url-filter'], 'i').test(unrelated)
      )

      assert.deepEqual(
        overBroad.map((rule) => rule.trigger['url-filter']),
        [],
        `${list} has a rule broad enough to block any page's requests`
      )
    }
  })

  // A converter fix is worthless if the device keeps serving the rules it built
  // last week. Both caches key on the filter-list snapshot, and that does not
  // move when the converter does, so the version has to.
  test('a converter change invalidates the rules already on the device', async () => {
    const { readFile } = await import('node:fs/promises')
    const blocker = await readFile(
      new URL('../../plugins/templates/PeerSkyContentBlocker.m.template', import.meta.url),
      'utf8'
    )
    const ruleFiles = await readFile(
      new URL('../../app/privacy/webkitContentRules.ts', import.meta.url),
      'utf8'
    )

    assert.match(ruleFiles, /\.v\$\{WEBKIT_RULE_FORMAT_VERSION\}\$\{WEBKIT_RULE_SUFFIX\}/)
    assert.match(ruleFiles, /removeStaleRuleFiles\(/)
    assert.match(blocker, /peersky-%@-%@-%lu", snapshotName, PeerSkyRuleFormatVersion/)
    assert.match(blocker, /peersky-%@-%@-", snapshotName, PeerSkyRuleFormatVersion/)

    const nativeVersion = /PeerSkyRuleFormatVersion = @"v([0-9]+)"/.exec(blocker)?.[1]
    assert.equal(Number(nativeVersion), WEBKIT_RULE_FORMAT_VERSION)
  })

  // Switching blocking off used to leave every open tab blocking, because rule
  // lists are attached when a WKWebView is built and nothing re-read them. The
  // same gap left the first page of a cold start unprotected, since the rules
  // finish compiling after that tab already exists.
  test('rule changes reach tabs that are already open', async () => {
    const { readFile } = await import('node:fs/promises')
    const blocker = await readFile(
      new URL('../../plugins/templates/PeerSkyContentBlocker.m.template', import.meta.url),
      'utf8'
    )

    assert.match(blocker, /liveControllers = \[NSHashTable weakObjectsHashTable\]/)
    assert.match(blocker, /\[self\.liveControllers addObject:configuration\.userContentController\]/)
    assert.match(
      blocker,
      /- \(void\)setEnabled:\(BOOL\)enabled[\s\S]{0,200}\[self applyRuleListsToOpenWebViews\]/
    )
    assert.match(
      blocker,
      /self\.ruleLists = \[compiled copy\];\s*\}\s*\[self applyRuleListsToOpenWebViews\]/
    )
    // Stale lists are dropped first, so a second pass cannot stack duplicates.
    assert.match(
      blocker,
      /removeAllContentRuleLists\];\s*if \(enabled\)/
    )
  })
  // EasyPrivacy lets Google Tag Manager run on some 450 sites in one 6.5 KB
  // line. Lines over 4 KB were skipped, so it was blocked on all of them.
  test('a filter for a long list of sites is kept', async () => {
    const sites = Array.from({ length: 450 }, (_, index) => `site-${index}.example`)
    const line = `@@||googletagmanager.com/gtm.js$domain=${sites.join('|')}`
    assert.ok(line.length > 4096)

    const rules = convertFilterListToWebKitRules(line)
    assert.equal(rules.length, 2)
    for (const rule of rules) {
      assert.equal(rule.action.type, 'ignore-previous-rules')
      assert.equal(rule.trigger['if-domain'].length, 450)
    }

    // The url-filter keeps its own limit.
    assert.deepEqual(convertFilterListToWebKitRules(`||${'a'.repeat(2100)}.example^`), [])
  })

  // WebKit compiles each list on its own, and an exception undoes only the
  // blocks before it in its own list. Ad blockers let one undo a block from
  // any list, so 27 exceptions the lists wrote never worked on iPhones.
  test('an exception in one list undoes a block from the other', () => {
    const easylist = [
      '||ads.example^',
      '@@||ads.example/allowed.js$script,domain=news.example'
    ].join('\n')
    const easyprivacy = [
      '||tracker.example^$third-party',
      '@@||tracker.example/consent.js$script,domain=shop.example'
    ].join('\n')
    const lists = convertFilterListsToWebKitRules([easylist, easyprivacy])

    // Each list's blocks first, then the exceptions of both.
    assert.deepEqual(lists.map((rules) => rules.map((rule) => rule.action.type)), [
      ['block', 'block', 'ignore-previous-rules', 'ignore-previous-rules'],
      ['block', 'block', 'ignore-previous-rules', 'ignore-previous-rules']
    ])

    const consent = { url: 'https://tracker.example/consent.js', type: 'script', page: 'https://shop.example/' }
    assert.equal(blockedByAny(lists, consent), false)
    // Where the exception does not reach, the block stands.
    assert.equal(blockedByAny(lists, { ...consent, page: 'https://other.example/' }), true)
    assert.equal(blockedByAny(lists, { url: 'https://tracker.example/pixel.gif', type: 'image', page: 'https://shop.example/' }), true)

    const ad = { url: 'https://ads.example/allowed.js', type: 'script', page: 'https://news.example/' }
    assert.equal(blockedByAny(lists, ad), false)
    assert.equal(blockedByAny(lists, { url: 'https://ads.example/banner.js', type: 'script', page: 'https://news.example/' }), true)

    // The same exception in both lists goes in once.
    const shared = '@@||cdn.example/lib.js$script'
    const [first] = convertFilterListsToWebKitRules([`||cdn.example^\n${shared}`, `||x.example^\n${shared}`])
    assert.equal(first.filter((rule) => rule.action.type === 'ignore-previous-rules').length, 1)
  })

  // An ad blocker lets no exception undo a block marked $important. Placed
  // with the other blocks, an exception after it undid it, and the long
  // exception above names two sites EasyPrivacy blocks Tag Manager on that way.
  test('nothing undoes an $important block, from either list', () => {
    const easyprivacy = [
      '||googletagmanager.com^$third-party',
      '||googletagmanager.com/gtm.js$important,domain=games.example',
      '@@||googletagmanager.com/gtm.js$domain=games.example|shop.example'
    ].join('\n')
    const easylist = '@@||googletagmanager.com/gtm.js$domain=games.example'
    const lists = convertFilterListsToWebKitRules([easylist, easyprivacy])

    // Its blocks, the exceptions of both lists, then the $important block,
    // each with its twin for frames.
    assert.deepEqual(lists[1].map((rule) => rule.action.type), [
      'block', 'block',
      'ignore-previous-rules', 'ignore-previous-rules', 'ignore-previous-rules', 'ignore-previous-rules',
      'block', 'block'
    ])
    const gtm = 'https://www.googletagmanager.com/gtm.js?id=GTM-1'
    assert.equal(blockedByAny(lists, { url: gtm, type: 'script', page: 'https://games.example/' }), true)
    assert.equal(blockedByAny(lists, { url: gtm, type: 'script', page: 'https://shop.example/' }), false)
    assert.equal(blockedByAny(lists, { url: gtm, type: 'script', page: 'https://elsewhere.example/' }), true)

    // An $important exception still has the last word, as in an ad blocker.
    const [rules] = convertFilterListsToWebKitRules([[
      '||cdn.example^$important',
      '@@||cdn.example/app.js$important,script'
    ].join('\n')])
    assert.deepEqual(rules.map((rule) => rule.action.type), ['block', 'block', 'ignore-previous-rules'])
    assert.equal(webkitBlocks(rules, { url: 'https://cdn.example/app.js', type: 'script', page: 'https://a.example/' }), false)
  })

  test('collecting exceptions, at once or a batch at a time, finds the same rules', async () => {
    const contents = [
      '||ads.example^',
      '@@||ads.example/ok.js$script',
      '  @@||cdn.example^$important',
      '! @@ in a comment'
    ].join('\n')
    const collected = collectWebKitExceptions(contents)
    assert.equal(collected.exceptions.length, 1)
    assert.equal(collected.importantExceptions.length, 2)
    assert.deepEqual(await collectWebKitExceptionsAsync(contents, { batchSize: 1, yieldControl: async () => {} }), collected)
  })

  test('the bundled lists keep every block, gain only the other list\'s exceptions, and fit WebKit', async () => {
    const { readFile } = await import('node:fs/promises')
    const contents = await Promise.all(['easylist', 'easyprivacy'].map((list) => readFile(
      new URL(`../../assets/content-blocking/${list}.txt`, import.meta.url),
      'utf8'
    )))
    const alone = contents.map((text) => convertFilterListToWebKitRules(text))
    const lists = convertFilterListsToWebKitRules(contents)
    const of = (rules, type) => rules.filter((rule) => rule.action.type === type)
    const keys = (rules) => rules.map((rule) => JSON.stringify(rule))

    for (let index = 0; index < lists.length; index++) {
      const rules = lists[index]
      assert.ok(rules.length <= MAX_WEBKIT_RULES_PER_LIST)
      // The same blocks, in the same order.
      assert.equal(JSON.stringify(of(rules, 'block')), JSON.stringify(of(alone[index], 'block')))

      const exceptions = keys(of(rules, 'ignore-previous-rules'))
      assert.equal(new Set(exceptions).size, exceptions.length)
      assert.deepEqual(new Set(exceptions), new Set([
        ...keys(of(alone[index], 'ignore-previous-rules')),
        ...keys(of(alone[1 - index], 'ignore-previous-rules'))
      ]))
    }

    // Trackers and ads are still blocked on an ordinary page.
    const page = 'https://news.example.org/story'
    for (const [url, type] of [
      ['https://www.google-analytics.com/analytics.js', 'script'],
      ['https://www.googletagmanager.com/gtag/js?id=G-TEST', 'script'],
      ['https://www.googletagmanager.com/gtm.js?id=GTM-TEST', 'script'],
      ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script'],
      ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script'],
      ['https://connect.facebook.net/en_US/fbevents.js', 'script'],
      ['https://static.hotjar.com/c/hotjar-1234.js', 'script'],
      ['https://bat.bing.com/bat.js', 'script']
    ]) {
      assert.equal(blockedByAny(lists, { url, type, page }), true, url)
    }

    // EasyPrivacy's long exception for Tag Manager now works, except where an
    // $important block says otherwise.
    const gtmLine = contents[1].split(/\r?\n/).find((line) => line.startsWith('@@||googletagmanager.com/gtm.js$domain='))
    if (gtmLine) {
      assert.ok(gtmLine.length > 4096)
      const important = new Set(contents[1].split(/\r?\n/)
        .filter((line) => /^\|\|googletagmanager\.com\/gtm\.js\$important,domain=/.test(line))
        .flatMap((line) => line.split('domain=')[1].split('|')))
      const sites = gtmLine.split('domain=')[1].split('|').filter((name) => !name.startsWith('~'))
      const gtm = 'https://www.googletagmanager.com/gtm.js?id=GTM-TEST'
      const allowed = sites.find((name) => !important.has(name))
      assert.equal(blockedByAny(lists, { url: gtm, type: 'script', page: `https://${allowed}/` }), false, allowed)
      for (const name of important) {
        if (sites.includes(name)) assert.equal(blockedByAny(lists, { url: gtm, type: 'script', page: `https://${name}/` }), true, name)
      }
    }
  })
})
