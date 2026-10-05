export const FORCE_DARK_STYLE_ID = 'peersky-force-dark'

/**
 * Dark mode on a site that never built one. Inverting the page and rotating
 * the hue back works on any site without knowing its styles. Pictures, video
 * and anything drawn are inverted again so they come out the right way round.
 *
 * A page that is already dark is left alone, since inverting it would turn it
 * white. That is judged from what is on screen, not from the page's root: a
 * video page on YouTube has a black root under a white list. And it is judged
 * again whenever the page changes its theme or moves to another page without
 * loading one, because the first answer stayed for good, and a page that went
 * dark later came out inverted, with its own white icons on a light bar.
 *
 * A page that says it is dark is believed first: YouTube marks its dark theme
 * on the root, and a Short is nothing but video, where sampling finds nothing
 * to go on. The page is read with this rule switched off, since the white the
 * rule paints the root with was read back as the page being light, and an
 * inverted page then stayed inverted.
 */
export function createForceDarkScript (enabled) {
  if (!enabled) return createForceDarkRemovalScript()

  return `(() => {
    const STYLE_ID = '${FORCE_DARK_STYLE_ID}'
    window.__peerskyForceDarkOn = true
    if (typeof window.__peerskyForceDarkCheck === 'function') {
      window.__peerskyForceDarkCheck()
      return
    }

    const luminance = (color) => {
      const parts = String(color || '').match(/[0-9.]+/g)
      if (!parts || parts.length < 3) return null
      // Mostly see-through tells us little: a dark page's buttons are a faint
      // white over it, and a light page dims under a dark veil.
      if (parts.length > 3 && Number(parts[3]) < 0.5) return null
      const [red, green, blue] = parts.map(Number)
      return red * 0.299 + green * 0.587 + blue * 0.114
    }

    // What a page says about its own theme: YouTube's dark attribute, the
    // theme attributes and classes most sites switch, or a page that is only
    // ever dark.
    const DARK_ATTRIBUTES = ['dark', 'darker-dark-theme']
    const THEME_ATTRIBUTES = ['data-theme', 'data-color-mode', 'data-bs-theme', 'data-color-scheme', 'theme']
    const DARK_CLASSES = ['dark', 'dark-mode', 'darkmode', 'dark-theme', 'theme-dark', 'night-mode']
    const saysDark = () => {
      for (const element of [document.documentElement, document.body]) {
        if (!element) continue
        if (DARK_ATTRIBUTES.some((name) => element.hasAttribute(name))) return true
        if (THEME_ATTRIBUTES.some((name) => /dark/i.test(element.getAttribute(name) || ''))) return true
        if (DARK_CLASSES.some((name) => element.classList.contains(name))) return true
      }
      const meta = document.querySelector('meta[name="color-scheme"]')
      const scheme = meta ? (meta.getAttribute('content') || '').trim().toLowerCase() : ''
      return scheme === 'dark' || scheme === 'only dark'
    }

    // A page that paints no background at all shows the canvas, which is dark
    // when the page takes a dark scheme and one is asked for.
    const canvas = () => {
      const scheme = getComputedStyle(document.documentElement).colorScheme || ''
      return /dark/.test(scheme) && matchMedia('(prefers-color-scheme: dark)').matches ? 0 : 255
    }

    // The colour behind a point on screen: the first element there, or above
    // it, that paints one. A picture there says nothing about the page.
    const backgroundAt = (x, y) => {
      let element = document.elementFromPoint(x, y)
      while (element && element !== document.documentElement) {
        if (/^(img|video|canvas|svg|picture|iframe)$/i.test(element.tagName)) return null
        const value = luminance(getComputedStyle(element).backgroundColor)
        if (value !== null) return value
        element = element.parentElement
      }
      const root = luminance(getComputedStyle(document.documentElement).backgroundColor)
      return root === null ? canvas() : root
    }

    const isAlreadyDark = () => {
      if (!document.body) return false
      if (saysDark()) return true
      let dark = 0
      let light = 0
      for (const [across, down] of [[0.5, 0.3], [0.5, 0.55], [0.5, 0.8], [0.15, 0.55], [0.85, 0.55]]) {
        const value = backgroundAt(innerWidth * across, innerHeight * down)
        if (value === null) continue
        if (value < 128) dark++
        else light++
      }
      if (dark + light > 0) return dark >= light
      // Nothing on screen to go on, all of it video or pictures: the page's
      // own background then, the body's or else the root's.
      for (const element of [document.body, document.documentElement]) {
        const value = luminance(getComputedStyle(element).backgroundColor)
        if (value !== null) return value < 128
      }
      return canvas() < 128
    }

    const MEDIA = 'img,picture,video,canvas,svg,iframe,embed,object,[style*="background-image"]'

    const check = () => {
      const existing = document.getElementById(STYLE_ID)
      let dark = false
      if (window.__peerskyForceDarkOn) {
        // Read the page as it is without this rule, which paints the root white.
        const sheet = existing && existing.sheet
        if (sheet) sheet.disabled = true
        try {
          dark = isAlreadyDark()
        } finally {
          if (sheet) sheet.disabled = false
        }
      }
      if (!window.__peerskyForceDarkOn || dark) {
        if (existing) existing.remove()
        return
      }
      if (existing) return

      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        'html{filter:invert(1) hue-rotate(180deg) !important;background:#ffffff !important;}',
        MEDIA + '{filter:invert(1) hue-rotate(180deg) !important;}',
        // Once is enough: a picture in a picture turned back twice came out
        // a negative again.
        ':is(' + MEDIA + ') :is(' + MEDIA + '){filter:none !important;}'
      ].join('')
      ;(document.head || document.documentElement).appendChild(style)
    }

    let pending = false
    const schedule = () => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        check()
      })
    }
    window.__peerskyForceDarkCheck = schedule

    check()
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', schedule, { once: true })
    }
    // Themes are often decided after load, and single-page sites move on
    // without a new document, so this looks again when either could happen.
    const watched = { attributes: true, attributeFilter: ['class', 'style', ...DARK_ATTRIBUTES, ...THEME_ATTRIBUTES] }
    const observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, watched)
    const watchBody = () => { if (document.body) observer.observe(document.body, watched) }
    watchBody()
    document.addEventListener('DOMContentLoaded', watchBody, { once: true })
    for (const name of ['pushState', 'replaceState']) {
      const original = history[name]
      history[name] = function () {
        const result = original.apply(this, arguments)
        setTimeout(schedule, 300)
        setTimeout(schedule, 1200)
        return result
      }
    }
    addEventListener('popstate', () => setTimeout(schedule, 300))
    addEventListener('load', schedule)
    for (const delay of [500, 1500, 3000]) setTimeout(schedule, delay)
  })(); true;`
}

export function createForceDarkRemovalScript () {
  return `(() => {
    // The watcher stays on the page, so it is told to stop as well.
    window.__peerskyForceDarkOn = false
    const style = document.getElementById('${FORCE_DARK_STYLE_ID}')
    if (style) style.remove()
  })(); true;`
}
