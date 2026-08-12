import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'
import {
  MAX_WEBKIT_RULES_PER_LIST,
  convertFilterListToWebKitRules,
  convertFilterListToWebKitRulesAsync,
  serializeWebKitContentRuleChunks,
  serializeWebKitContentRules
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

    assert.equal(rules.length, 1)
    assert.deepEqual(rules[0].trigger['if-domain'], ['*example.com'])
    assert.deepEqual(rules[0].trigger['unless-domain'], ['*private.example.com'])
  })

  test('bounds output and keeps exceptions after blocking rules', () => {
    const rules = convertFilterListToWebKitRules([
      '@@||allow.example^',
      '||one.example^',
      '||two.example^'
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
    assert.equal(rules.length, 45_001)
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
    assert.match(blocker, /self[.]ruleLists = \[compiled copy\]/)
    assert.match(blocker, /if \(error\) \{\s*completion\(error\);\s*return;/)
    assert.match(webView, /<react-native-webview\/RNCWebViewImpl[.]h>/)
    assert.match(webView, /<react-native-webview\/RNCWebViewManager[.]h>/)
    assert.match(webView, /setUpWkWebViewConfig/)
    assert.match(webView, /RCT_EXPORT_MODULE\(PeerSkyWebView\)/)
    assert.match(module, /hasPrefix:allowedPrefix/)
    assert.match(module, /snapshot-\[0-9\]/)
  })
})
