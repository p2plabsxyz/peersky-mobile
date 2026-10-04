import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'
import {
  MAX_WEBKIT_RULES_PER_LIST,
  convertFilterListToWebKitRules,
  convertFilterListToWebKitRulesAsync,
  serializeWebKitContentRuleChunks,
  serializeWebKitContentRules,
  WEBKIT_RULE_FORMAT_VERSION
} from '../../app/privacy/webkit-content-rules.mjs'

const require = createRequire(import.meta.url)
const plugin = require('../../plugins/with-browser-downloads')

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
})
