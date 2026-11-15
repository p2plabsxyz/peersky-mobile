import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  EXTERNAL_LINK_LAUNCH_COOLDOWN_MS,
  MAX_EXTERNAL_LINK_LENGTH,
  canPromptExternalLink,
  formatExternalLinkForPrompt,
  getExternalAppName,
  getExternalLinkBehaviorAction,
  getExternalLinkTarget,
  getIntentFallbackUrl,
  parseAppLink,
  parseExternalAppLink
} from '../../app/browser-permissions.mjs'

describe('browser external app permissions', () => {
  test('accepts only explicitly supported external app schemes', () => {
    assert.deepEqual(parseExternalAppLink('mailto:test@example.com'), {
      scheme: 'mailto',
      url: 'mailto:test@example.com'
    })
    assert.deepEqual(parseExternalAppLink('tel:+123456789'), {
      scheme: 'tel',
      url: 'tel:+123456789'
    })
    assert.deepEqual(parseExternalAppLink('sms:+123456789?body=hello'), {
      scheme: 'sms',
      url: 'sms:+123456789?body=hello'
    })
    assert.deepEqual(parseExternalAppLink('geo:0,0?q=London'), {
      scheme: 'geo',
      url: 'geo:0,0?q=London'
    })
  })

  test('rejects dangerous arbitrary malformed and oversized schemes', () => {
    assert.equal(parseExternalAppLink('intent://scan/#Intent;scheme=zxing;end'), null)
    assert.equal(parseExternalAppLink('javascript:alert(1)'), null)
    assert.equal(parseExternalAppLink('file:///private/data'), null)
    assert.equal(parseExternalAppLink('custom-app://open'), null)
    assert.equal(parseExternalAppLink('not a url'), null)
    assert.equal(parseExternalAppLink(`mailto:${'a'.repeat(MAX_EXTERNAL_LINK_LENGTH)}`), null)
  })

  test('enforces the external link length boundary', () => {
    const prefix = 'mailto:'
    const atLimit = `${prefix}${'a'.repeat(MAX_EXTERNAL_LINK_LENGTH - prefix.length)}`
    assert.equal(parseExternalAppLink(atLimit)?.url.length, MAX_EXTERNAL_LINK_LENGTH)
    assert.equal(parseExternalAppLink(`${atLimit}a`), null)
  })

  test('provides bounded readable prompt details', () => {
    assert.equal(getExternalAppName('mailto'), 'your email app')
    assert.equal(getExternalAppName('unknown'), 'another app')
    assert.equal(formatExternalLinkForPrompt('tel:+123\n456'), 'tel:+123456')
    assert.equal(formatExternalLinkForPrompt(`mailto:${'a'.repeat(200)}`, 20).length, 20)
    assert.equal(formatExternalLinkForPrompt('mailto:aaaa😀bbbb', 13), 'mailto:aaa...')
    assert.equal(formatExternalLinkForPrompt('mailto:aaaa😀bbbb', 14), 'mailto:aaaa...')
  })

  test('maps persisted behavior to a safe browser action', () => {
    assert.equal(getExternalLinkBehaviorAction('ask'), 'prompt')
    assert.equal(getExternalLinkBehaviorAction('allow'), 'open')
    assert.equal(getExternalLinkBehaviorAction('block'), 'block')
    assert.equal(getExternalLinkBehaviorAction('unknown'), 'prompt')
  })

  test('rate limits repeated external link prompts', () => {
    const now = 10000
    assert.equal(canPromptExternalLink(0, now), true)
    assert.equal(canPromptExternalLink(now, now + EXTERNAL_LINK_LAUNCH_COOLDOWN_MS - 1), false)
    assert.equal(canPromptExternalLink(now, now + EXTERNAL_LINK_LAUNCH_COOLDOWN_MS), true)
    assert.equal(canPromptExternalLink(Number.NaN, now), false)
  })

  // A phone with no mail app answers "cannot open" to a perfectly good address.
  // Saying so and stopping leaves the person stuck, so hand them the address.
  test('reads the address out of a link no app could open', () => {
    assert.equal(
      getExternalLinkTarget('mailto:contact@p2plabs.xyz?subject=Some%20subject&body=Some%20body'),
      'contact@p2plabs.xyz'
    )
    assert.equal(getExternalLinkTarget('mailto:contact@p2plabs.xyz'), 'contact@p2plabs.xyz')
    assert.equal(getExternalLinkTarget('tel:+15550100'), '+15550100')
    assert.equal(getExternalLinkTarget('https://example.com'), null)
    assert.equal(getExternalLinkTarget(''), null)
  })
})

// App Store, WhatsApp, Spotify, Maps and Play Store links went nowhere, with no
// word: only mail, phone, messages and maps were let through.
describe('links to other apps', () => {
  test('knows an app\'s own link from the browser\'s schemes', () => {
    for (const url of [
      'itms-apps://apps.apple.com/app/id284882215',
      'whatsapp://send?text=hello',
      'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
      'maps://?q=coffee',
      'market://details?id=org.mozilla.firefox',
      'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end'
    ]) {
      assert.equal(parseAppLink(url)?.url, url, url)
    }
    assert.deepEqual(parseAppLink('Spotify:track:1'), { scheme: 'spotify', url: 'Spotify:track:1' })
    assert.deepEqual(parseAppLink('mailto:a@example.com'), { scheme: 'mailto', url: 'mailto:a@example.com' })
    for (const url of [
      'https://example.com', 'http://example.com', 'hyper://site/', 'hs://key', 'peersky://p2p',
      'javascript:alert(1)', 'data:text/html,hi', 'blob:https://example.com/x', 'about:blank',
      'file:///etc/hosts', 'content://media/external/images/1', 'browser://theme/vars.css',
      'whatsapp://send?text=two words', 'whats app://x', 'not a link', '', null,
      `whatsapp://send?text=${'a'.repeat(MAX_EXTERNAL_LINK_LENGTH)}`
    ]) {
      assert.equal(parseAppLink(url), null, String(url))
    }
  })

  test('reads an intent:// link\'s web page to fall back on', () => {
    const fallback = 'https://example.com/scan?x=1'
    const link = `intent://scan/#Intent;scheme=zxing;package=com.example;S.browser_fallback_url=${encodeURIComponent(fallback)};end`
    assert.equal(getIntentFallbackUrl(link), fallback)
    assert.equal(getIntentFallbackUrl('intent://scan/#Intent;scheme=zxing;end'), null)
    assert.equal(getIntentFallbackUrl(`intent://x/#Intent;S.browser_fallback_url=${encodeURIComponent('javascript:alert(1)')};end`), null)
    assert.equal(getIntentFallbackUrl(`intent://x/#Intent;S.browser_fallback_url=${encodeURIComponent('market://details?id=x')};end`), null)
    assert.equal(getIntentFallbackUrl(`spotify:x#Intent;S.browser_fallback_url=${encodeURIComponent(fallback)};end`), null)
  })
})
