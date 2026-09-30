export const FORCE_DARK_STYLE_ID = 'peersky-force-dark'

/**
 * Dark mode on a site that never built one.
 *
 * Inverting the page and rotating the hue back is the only approach that works
 * on every site without knowing anything about it: no stylesheet to write, no
 * class names to guess. Pictures, video and anything drawn get inverted a
 * second time so they come back out the right way round.
 *
 * Two things it deliberately does not do. A page that is already dark is left
 * alone, because inverting it would turn it white, which is the opposite of
 * what was asked for. And an inverted page is checked again on the next load
 * rather than remembered, since the same site can be light on one page and
 * dark on the next.
 */
export function createForceDarkScript (enabled) {
  if (!enabled) return createForceDarkRemovalScript()

  return `(() => {
    const STYLE_ID = '${FORCE_DARK_STYLE_ID}'

    // The page's own background, resolved through whatever it inherits from.
    // A page that already reads as dark is left alone.
    const isAlreadyDark = () => {
      const scan = [document.documentElement, document.body]
      for (const element of scan) {
        if (!element) continue
        const color = getComputedStyle(element).backgroundColor
        const parts = color.match(/[0-9.]+/g)
        if (!parts || parts.length < 3) continue
        // Fully transparent tells us nothing; keep looking.
        if (parts.length > 3 && Number(parts[3]) === 0) continue
        const [red, green, blue] = parts.map(Number)
        return (red * 0.299 + green * 0.587 + blue * 0.114) < 128
      }
      return false
    }

    const apply = () => {
      const existing = document.getElementById(STYLE_ID)
      if (isAlreadyDark()) {
        if (existing) existing.remove()
        return
      }
      if (existing) return

      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        'html{filter:invert(1) hue-rotate(180deg) !important;background:#ffffff !important;}',
        'img,picture,video,canvas,svg,iframe,embed,object,',
        '[style*="background-image"]{filter:invert(1) hue-rotate(180deg) !important;}'
      ].join('')
      ;(document.head || document.documentElement).appendChild(style)
    }

    apply()
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true })
    }
  })(); true;`
}

export function createForceDarkRemovalScript () {
  return `(() => {
    const style = document.getElementById('${FORCE_DARK_STYLE_ID}')
    if (style) style.remove()
  })(); true;`
}
