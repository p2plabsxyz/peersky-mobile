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

export function getExternalAppName (scheme) {
  if (scheme === 'mailto') return 'your email app'
  if (scheme === 'tel') return 'your phone app'
  if (scheme === 'sms') return 'your messaging app'
  if (scheme === 'geo') return 'your maps app'
  return 'another app'
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
