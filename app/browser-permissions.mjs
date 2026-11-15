import { t } from './i18n/i18n.mjs'

export const EXTERNAL_LINK_BEHAVIORS = ['ask', 'allow', 'block']
export const MAX_EXTERNAL_LINK_LENGTH = 2048
export const EXTERNAL_LINK_LAUNCH_COOLDOWN_MS = 3000

const EXTERNAL_APP_SCHEMES = new Set(['geo:', 'mailto:', 'sms:', 'tel:'])

export function parseExternalAppLink (url) {
  if (typeof url !== 'string' || url.length < 1 || url.length > MAX_EXTERNAL_LINK_LENGTH) return null

  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol.toLowerCase()
    if (!EXTERNAL_APP_SCHEMES.has(protocol)) return null

    return {
      scheme: protocol.slice(0, -1),
      url: parsed.toString()
    }
  } catch {
    return null
  }
}

// The browser's own schemes, and ones that name a file or a document on the
// phone, which a page never hands to another app.
const NOT_APP_SCHEMES = new Set([
  'about:', 'agregore:', 'android-app:', 'blob:', 'browser:', 'chrome:', 'content:',
  'data:', 'file:', 'filesystem:', 'hs:', 'http:', 'https:', 'hyper:', 'ipfs:',
  'ipns:', 'javascript:', 'peersky:', 'ws:', 'wss:'
])
const APP_LINK_SCHEME = /^([a-z][a-z0-9+.-]*):/i

/**
 * A link to another app: mail, phone, messages and maps (parseExternalAppLink),
 * or an app's own scheme, as App Store (itms-apps:), WhatsApp, Spotify, Maps and
 * Play Store (market:) links are, and Android's intent:// links. Null for the
 * browser's own schemes and anything that is not a link.
 */
export function parseAppLink (url) {
  const known = parseExternalAppLink(url)
  if (known) return known
  if (typeof url !== 'string' || url.length < 1 || url.length > MAX_EXTERNAL_LINK_LENGTH) return null
  // No link an app is handed has a space or a control character in it.
  for (let index = 0; index < url.length; index++) {
    const code = url.charCodeAt(index)
    if (code <= 32 || code === 127) return null
  }
  const match = APP_LINK_SCHEME.exec(url)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  if (NOT_APP_SCHEMES.has(`${scheme}:`)) return null
  return { scheme, url }
}

/**
 * The web page an Android intent:// link says to open when no app is there to
 * take it (S.browser_fallback_url), if it names an http:// or https:// one.
 */
export function getIntentFallbackUrl (url) {
  const value = String(url || '')
  if (!/^intent:/i.test(value)) return null
  const start = value.indexOf('#Intent;')
  if (start < 0) return null
  const field = value.slice(start + '#Intent;'.length).split(';')
    .find((part) => part.startsWith('S.browser_fallback_url='))
  if (!field) return null
  try {
    const fallback = new URL(decodeURIComponent(field.slice('S.browser_fallback_url='.length)))
    return fallback.protocol === 'https:' || fallback.protocol === 'http:' ? fallback.href : null
  } catch {
    return null
  }
}

export function getExternalAppName (scheme) {
  if (scheme === 'mailto') return t('your email app')
  if (scheme === 'tel') return t('your phone app')
  if (scheme === 'sms') return t('your messaging app')
  if (scheme === 'geo') return t('your maps app')
  return t('another app')
}

// What a link is actually addressed to, for when no app can open it. A mailto:
// carries a subject and a body in its query; the part worth showing, and worth
// copying, is the address on its own.
export function getExternalLinkTarget (url) {
  const link = parseExternalAppLink(url)
  if (!link) return null

  const target = link.url.slice(link.scheme.length + 1).split('?')[0]
  try {
    return decodeURIComponent(target).trim() || null
  } catch {
    return target.trim() || null
  }
}

export function canPromptExternalLink (lastPromptAt, now = Date.now()) {
  if (!Number.isFinite(lastPromptAt) || !Number.isFinite(now)) return false
  return now - lastPromptAt >= EXTERNAL_LINK_LAUNCH_COOLDOWN_MS
}

export function getExternalLinkBehaviorAction (behavior) {
  if (behavior === 'block') return 'block'
  if (behavior === 'allow') return 'open'
  return 'prompt'
}

export function formatExternalLinkForPrompt (url, maxLength = 160) {
  const limit = Number.isInteger(maxLength) && maxLength >= 4
    ? Math.min(maxLength, 512)
    : 160
  const normalized = Array.from(String(url || ''))
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
  if (normalized.length <= limit) return normalized.join('')
  return `${normalized.slice(0, limit - 3).join('')}...`
}
