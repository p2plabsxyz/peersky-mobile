import { WEBSITE_TEXT_SCALES } from './settings/browser-preferences.mjs'
import {
  DEFAULT_BROWSER_PAGE_ZOOM,
  normalizeBrowserPageZoom
} from './browser-tabs.mjs'

export function createBrowserAccessibilityScript ({
  applyTextScale,
  desktopView = false,
  enforceManualPageZoom,
  pageZoom = DEFAULT_BROWSER_PAGE_ZOOM,
  websiteTextScale
}) {
  const baseScale = WEBSITE_TEXT_SCALES.includes(websiteTextScale) ? websiteTextScale : 100
  const scale = Math.round(baseScale * normalizeBrowserPageZoom(pageZoom) / 100)
  const shouldUseDesktopView = desktopView === true
  const shouldApplyTextScale = applyTextScale === true
  const shouldEnforceZoom = enforceManualPageZoom === true

  return `(() => {
    const root = document.documentElement
    if (root && ${shouldApplyTextScale}) {
      root.style.setProperty('-webkit-text-size-adjust', '${scale}%', 'important')
    }

    const marker = 'data-peersky-original-content'
    let viewport = document.querySelector('meta[name="viewport"]')

    if (${shouldUseDesktopView} || ${shouldEnforceZoom}) {
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
        return part && !/^(width|initial-scale|minimum-scale|user-scalable|maximum-scale)\\s*=/i.test(part)
      })

      const applyViewport = () => {
        const nextViewport = preserved.slice()
        if (${shouldUseDesktopView}) {
          // Ignore desktop-width values from a previous navigation when choosing the phone scale.
          const viewportWidths = [
            window.visualViewport && window.visualViewport.width,
            document.documentElement && document.documentElement.clientWidth,
            window.innerWidth,
            window.screen && window.screen.width
          ].filter((value) => Number.isFinite(value) && value > 0 && value < 1024)
          const deviceWidth = viewportWidths.length > 0 ? Math.min(...viewportWidths) : 390
          const desktopScale = Math.max(0.25, Math.min(1, deviceWidth / 1024))
          nextViewport.push(
            'width=1024',
            'initial-scale=' + desktopScale.toFixed(3),
            'minimum-scale=' + desktopScale.toFixed(3),
            'user-scalable=yes'
          )
        }
        if (${shouldEnforceZoom}) nextViewport.push('user-scalable=yes', 'maximum-scale=5')
        viewport.setAttribute('content', nextViewport.join(', '))
      }

      applyViewport()
      window.addEventListener('pageshow', applyViewport, { once: true })
      window.addEventListener('orientationchange', () => setTimeout(applyViewport, 80), { once: true })
    } else if (viewport && viewport.hasAttribute(marker)) {
      const original = viewport.getAttribute(marker) || ''
      if (original) viewport.setAttribute('content', original)
      else viewport.remove()
    }

    true
  })()`
}
