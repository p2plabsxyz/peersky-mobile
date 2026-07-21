import { WEBSITE_TEXT_SCALES } from './settings/browser-preferences.mjs'

export function createBrowserAccessibilityScript ({
  applyTextScale,
  enforceManualPageZoom,
  websiteTextScale
}) {
  const scale = WEBSITE_TEXT_SCALES.includes(websiteTextScale) ? websiteTextScale : 100
  const shouldApplyTextScale = applyTextScale === true
  const shouldEnforceZoom = enforceManualPageZoom === true

  return `(() => {
    const root = document.documentElement
    if (root && ${shouldApplyTextScale}) {
      root.style.setProperty('-webkit-text-size-adjust', '${scale}%', 'important')
    }

    const marker = 'data-peersky-original-content'
    let viewport = document.querySelector('meta[name="viewport"]')

    if (${shouldEnforceZoom}) {
      if (!viewport) {
        viewport = document.createElement('meta')
        viewport.setAttribute('name', 'viewport')
        viewport.setAttribute(marker, '')
        document.head.appendChild(viewport)
      } else if (!viewport.hasAttribute(marker)) {
        viewport.setAttribute(marker, viewport.getAttribute('content') || '')
      }

      const original = viewport.getAttribute(marker) || ''
      const preserved = original.split(',').map((part) => part.trim()).filter((part) => {
        return part && !/^(user-scalable|maximum-scale)\\s*=/i.test(part)
      })
      viewport.setAttribute('content', preserved.concat(['user-scalable=yes', 'maximum-scale=5']).join(', '))
    } else if (viewport && viewport.hasAttribute(marker)) {
      const original = viewport.getAttribute(marker) || ''
      if (original) viewport.setAttribute('content', original)
      else viewport.remove()
    }

    true
  })()`
}
