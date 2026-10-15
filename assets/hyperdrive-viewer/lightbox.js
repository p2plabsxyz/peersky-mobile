/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { h, icon, iconButton, button, toast, copyWithToast, openMenu, closeMenu, prefersReducedMotion, replace } from '/hyperdrive/viewer/ui.js'
import { t, formatDate, formatBytes, formatNumber, formatDuration, regionName } from '/hyperdrive/viewer/i18n.js'
import { kindOf } from '/hyperdrive/viewer/lib/kinds.js'
import { createPlaceIndex, nearestPlace } from '/hyperdrive/viewer/lib/places.js'
import { displayName, parentPath, folderTitle } from '/hyperdrive/viewer/route.js'

// Photos and clips one at a time, over everything else: prev and next by
// arrow, key or swipe, zoom by wheel, pinch or double tap, swipe down or Esc
// to close, Live Photos that move on hover or a long press, and a panel with
// what the file says about itself. Places come from the table in
// data/places.js on this device; nothing about a photo leaves it.

const GAP = 16
const MAX_ZOOM = 6
const SLIDESHOW_MS = 4000
let infoOpen = false
let placeIndex = null

function placesTable () {
  if (!placeIndex) {
    placeIndex = import('/hyperdrive/viewer/data/places.js')
      .then((module) => createPlaceIndex(module.default))
      .catch(() => null)
  }
  return placeIndex
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const nameOf = (path) => path.split('/').pop()
// For showing; downloads and shares keep the name as stored.
const shownName = (path) => displayName(nameOf(path))

function exposureText (seconds) {
  if (!(seconds > 0)) return ''
  if (seconds >= 1) return t('{value} s', { value: formatNumber(seconds, { maximumFractionDigits: 1 }) })
  return t('1/{value} s', { value: formatNumber(Math.round(1 / seconds)) })
}

function cameraName (make, model) {
  const cleanMake = String(make || '').trim()
  const cleanModel = String(model || '').trim()
  if (!cleanModel) return cleanMake
  if (!cleanMake || cleanModel.toLowerCase().startsWith(cleanMake.toLowerCase().split(' ')[0])) return cleanModel
  return `${cleanMake} ${cleanModel}`
}

/**
 * Opens the lightbox.
 * items: [{ path, size, mtime, kind?: 'image' | 'video', motion?: entry }]
 *   (motion: the moving part of a Live Photo).
 * options: { onChange(index, item), onClose(), slideshow: true to start one }
 * Returns { close(), goTo(index), element }.
 */
export function openLightbox (ctx, items, startIndex = 0, options = {}) {
  const { source, thumbs } = ctx
  const host = ctx.route.host
  if (!items || !items.length) return null
  const previousFocus = document.activeElement
  const rtl = document.documentElement.dir === 'rtl'
  const direction = rtl ? -1 : 1
  const reduced = prefersReducedMotion()
  const phone = source.platform !== 'desktop'
  const lifetime = new AbortController()

  let index = clamp(startIndex, 0, items.length - 1)
  let closed = false
  let slideshowTimer = null
  let idleTimer = null
  const slides = new Map()

  const track = h('div', { class: 'hd-lb-track' })
  const stage = h('div', { class: 'hd-lb-stage' }, track)
  const nameLine = h('span', { class: 'hd-lb-name' })
  const counter = h('span', { class: 'hd-lb-counter' })
  const prevButton = iconButton(rtl ? 'forward' : 'back', t('Previous'), () => step(-1), { className: 'hd-lb-nav hd-lb-prev' })
  const nextButton = iconButton(rtl ? 'back' : 'forward', t('Next'), () => step(1), { className: 'hd-lb-nav hd-lb-next' })
  const infoButton = iconButton('info', t('Info'), () => toggleInfo(), { className: 'hd-lb-info-btn', pressed: infoOpen })
  const slideshowButton = iconButton('slideshow', t('Slideshow'), () => toggleSlideshow(), { className: 'hd-lb-wide', pressed: false })
  const moreButton = iconButton('more', t('More'), () => openMore(), { className: 'hd-lb-narrow' })
  moreButton.setAttribute('aria-haspopup', 'menu')
  const infoBody = h('div', { class: 'hd-lb-info-body' })
  const infoPanel = h('aside', { class: 'hd-lb-info', 'aria-label': t('Details') },
    h('div', { class: 'hd-lb-info-head' },
      h('h2', null, t('Details')),
      iconButton('close', t('Close details'), () => toggleInfo(false))),
    infoBody)

  const topBar = h('div', { class: 'hd-lb-top' },
    iconButton('close', t('Close'), () => close(), { className: 'hd-lb-close' }),
    h('div', { class: 'hd-lb-titles' }, nameLine, counter),
    h('div', { class: 'hd-lb-actions' },
      slideshowButton,
      iconButton('download', t('Download'), () => download(), { className: 'hd-lb-wide' }),
      iconButton('link', t('Copy link'), () => copyLink(), { className: 'hd-lb-wide' }),
      phone ? iconButton('share', t('Share'), () => share(), { className: 'hd-lb-wide' }) : null,
      iconButton('external', t('Open original'), () => openOriginal(), { className: 'hd-lb-wide' }),
      infoButton,
      moreButton))

  const root = h('div', {
    class: ['hd-lightbox', infoOpen && 'is-info-open'],
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('Photo viewer'),
    tabindex: '-1'
  }, h('div', { class: 'hd-lb-backdrop' }), stage, prevButton, nextButton, topBar, infoPanel)

  const current = () => slides.get(index)
  const item = () => items[index]

  function itemKind (entry) {
    if (entry.kind === 'video' || entry.kind === 'image') return entry.kind
    return kindOf(entry.path, entry.size) === 'video' ? 'video' : 'image'
  }

  // A panel in place of a file this engine cannot show.
  function cannotShow (slide, title) {
    const entry = slide.item
    slide.element.classList.add('is-cannot')
    replace(slide.element, h('div', { class: 'hd-lb-cannot' },
      h('div', { class: 'hd-lb-cannot-icon' }, icon('alert')),
      h('p', { class: 'hd-lb-cannot-title' }, title),
      h('p', { class: 'hd-lb-cannot-file' }, shownName(entry.path), entry.size ? ` · ${formatBytes(entry.size)}` : ''),
      h('div', { class: 'hd-lb-cannot-actions' },
        button({ label: t('Download'), icon: 'download', variant: 'primary', onClick: () => source.download(host, entry.path, nameOf(entry.path)) }),
        button({ label: t('Open in new tab'), icon: 'external', variant: 'overlay', onClick: () => source.open(host, entry.path) }))))
  }

  function buildImage (slide) {
    const entry = slide.item
    const box = h('div', { class: 'hd-lb-zoom' })
    const placeholder = h('img', { class: 'hd-lb-placeholder', alt: '', draggable: 'false' })
    const picture = h('img', { class: 'hd-lb-image', alt: shownName(entry.path), draggable: 'false', decoding: 'async' })
    const spinner = h('div', { class: 'hd-spinner hd-lb-spinner', 'aria-hidden': 'true' })
    box.append(placeholder, picture)
    slide.element.append(box, spinner)
    slide.box = box
    slide.picture = picture

    const entries = ctx.listing && ctx.listing.entries
    thumbs.photo(entry, { size: 'grid', entries, signal: slide.signal }).then((url) => {
      if (url && !slide.disposed && !slide.loaded) placeholder.setAttribute('src', url)
    }, () => {})

    const usePreview = () => {
      if (slide.disposed) return
      if (picture.getAttribute('src')) {
        // The original did not draw here; never leave a broken picture up.
        picture.removeAttribute('src')
        thumbs.originalFailed(entry)
      }
      thumbs.photo(entry, { size: 'hero', entries, signal: slide.signal }).then((url) => {
        if (slide.disposed) return
        if (!url && slide.showMotionStill && slide.showMotionStill()) return
        if (!url) {
          cannotShow(slide, t("This format can't be shown here"))
          return
        }
        picture.addEventListener('load', () => loaded(slide), { once: true })
        picture.setAttribute('src', url)
        slide.element.classList.add('is-preview')
        slide.element.append(h('span', { class: 'hd-lb-note' }, t('Preview')))
      }, (error) => {
        if (!slide.disposed && error.name !== 'AbortError') cannotShow(slide, t("This format can't be shown here"))
      })
    }

    slide.load = () => {
      if (slide.requested) return
      slide.requested = true
      // A HEIC photo this engine cannot draw shows its JPEG copy, when the
      // listing has one, before it gives up to the small preview.
      const copy = thumbs.copyOf(entry, entries)
      if (thumbs.canShowOriginal(entry) || copy) {
        picture.addEventListener('load', () => loaded(slide), { once: true })
        picture.addEventListener('error', usePreview, { once: true })
        picture.setAttribute('src', source.fileUrl(host, (copy || entry).path))
      } else {
        usePreview()
      }
    }

    if (entry.motion) buildLive(slide)
  }

  function buildLive (slide) {
    const motion = h('video', { class: 'hd-lb-motion', playsinline: true, muted: true, preload: 'none', 'aria-hidden': 'true', tabindex: '-1' })
    const badge = h('button', { type: 'button', class: 'hd-live-badge', 'aria-label': t('Play Live Photo') }, icon('live'), h('span', null, t('LIVE')))
    slide.box.append(motion)
    slide.element.append(badge)
    slide.element.classList.add('is-live')
    let holding = false
    const play = (withSound) => {
      if (!motion.getAttribute('src')) motion.setAttribute('src', source.fileUrl(host, slide.item.motion.path))
      motion.muted = !withSound
      try {
        motion.currentTime = 0
      } catch {}
      motion.play().then(() => slide.element.classList.add('is-moving'), () => {
        if (withSound) {
          motion.muted = true
          motion.play().then(() => slide.element.classList.add('is-moving'), () => {})
        }
      })
    }
    const stop = () => {
      if (holding) return
      motion.pause()
      slide.element.classList.remove('is-moving')
      if (slide.element.classList.contains('is-motion-still')) {
        try {
          motion.currentTime = 0
        } catch {}
      }
    }
    motion.addEventListener('ended', () => slide.element.classList.remove('is-moving'))
    badge.addEventListener('click', (event) => {
      event.stopPropagation()
      play(true)
    })
    for (const target of [badge, slide.box]) {
      target.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse' && slide.zoom.scale <= 1) play(false)
      })
      target.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse') stop()
      })
    }
    slide.playLive = (withSound) => {
      holding = true
      play(withSound)
    }
    // A still this engine cannot draw (HEIC on Chromium): the moving part's
    // first frame stands in for it, and still moves on hover or a press.
    slide.showMotionStill = () => {
      motion.preload = 'auto'
      if (!motion.getAttribute('src')) motion.setAttribute('src', source.fileUrl(host, slide.item.motion.path))
      slide.element.classList.add('is-motion-still')
      motion.addEventListener('loadeddata', () => loaded(slide), { once: true })
      motion.addEventListener('ended', () => {
        try {
          motion.currentTime = 0
        } catch {}
      })
      motion.addEventListener('error', () => {
        if (!slide.disposed) cannotShow(slide, t("This format can't be shown here"))
      }, { once: true })
      return true
    }
    slide.stopLive = () => {
      holding = false
      stop()
    }
  }

  function buildVideo (slide) {
    const entry = slide.item
    const video = h('video', { class: 'hd-lb-video', controls: true, playsinline: true, 'webkit-playsinline': true, preload: 'metadata' })
    const box = h('div', { class: 'hd-lb-zoom hd-lb-zoom--video' }, video)
    slide.element.append(box)
    slide.box = box
    slide.video = video
    video.addEventListener('error', () => {
      if (!slide.disposed && video.getAttribute('src')) cannotShow(slide, t("This video can't play here"))
    })
    video.addEventListener('loadeddata', () => loaded(slide), { once: true })
    thumbs.video(entry, { size: 'hero', signal: slide.signal, entries: ctx.listing && ctx.listing.entries, prefer: 'frame' }).then((url) => {
      if (url && !slide.disposed && !video.getAttribute('poster')) video.setAttribute('poster', url)
    }, () => {})
    slide.load = () => {
      if (slide.requested) return
      slide.requested = true
      video.setAttribute('src', source.fileUrl(host, entry.path))
    }
  }

  function makeSlide (at) {
    const entry = items[at]
    const controller = new AbortController()
    const element = h('div', { class: 'hd-lb-slide', role: 'group', 'aria-roledescription': t('slide'), 'aria-label': shownName(entry.path) })
    const slide = {
      index: at,
      item: entry,
      kind: itemKind(entry),
      element,
      controller,
      signal: controller.signal,
      zoom: { scale: 1, x: 0, y: 0 },
      disposed: false,
      loaded: false,
      requested: false
    }
    if (slide.kind === 'video') buildVideo(slide)
    else buildImage(slide)
    return slide
  }

  function loaded (slide) {
    if (slide.disposed) return
    slide.loaded = true
    slide.element.classList.add('is-loaded')
    // The ones next to it load once this one is in.
    if (slide.index === index) {
      for (const near of [index + 1, index - 1]) {
        const other = slides.get(near)
        if (other && other.kind === 'image' && other.load) other.load()
      }
    }
  }

  function dispose (slide) {
    slide.disposed = true
    slide.controller.abort()
    for (const media of slide.element.querySelectorAll('video')) {
      media.pause()
      media.removeAttribute('src')
      try {
        media.load()
      } catch {}
    }
    slide.element.remove()
  }

  function position () {
    for (const slide of slides.values()) {
      const offset = (slide.index - index) * direction
      slide.element.style.transform = offset ? `translateX(calc(${offset * 100}% + ${offset * GAP}px))` : ''
      slide.element.setAttribute('aria-hidden', String(slide.index !== index))
      slide.element.inert = slide.index !== index
    }
  }

  function goTo (at) {
    const target = clamp(at, 0, items.length - 1)
    const before = current()
    if (before && before.index !== target) {
      resetZoom(before, false)
      if (before.video) before.video.pause()
      if (before.stopLive) before.stopLive()
    }
    index = target
    for (const [at2, slide] of slides) {
      if (Math.abs(at2 - index) > 1) {
        dispose(slide)
        slides.delete(at2)
      }
    }
    for (const near of [index - 1, index, index + 1]) {
      if (near < 0 || near >= items.length || slides.has(near)) continue
      const slide = makeSlide(near)
      slides.set(near, slide)
      track.append(slide.element)
    }
    position()
    const slide = current()
    slide.load()
    if (slide.loaded) loaded(slide)
    if (slide.video) {
      slide.video.play().catch(() => {})
    }
    const entry = item()
    nameLine.textContent = shownName(entry.path)
    counter.textContent = items.length > 1 ? t('{index} of {count}', { index: formatNumber(index + 1), count: formatNumber(items.length) }) : ''
    prevButton.disabled = index === 0
    nextButton.disabled = index === items.length - 1
    root.classList.toggle('is-video', slide.kind === 'video')
    slideshowButton.hidden = items.length < 2
    if (infoOpen) renderInfo()
    if (options.onChange) options.onChange(index, entry)
  }

  function bump (delta) {
    if (reduced) return
    track.animate([
      { transform: 'translateX(0)' },
      { transform: `translateX(${-delta * direction * 24}px)` },
      { transform: 'translateX(0)' }
    ], { duration: 260, easing: 'ease-out' })
  }

  let moving = false
  function step (delta) {
    const target = index + delta
    if (target < 0 || target >= items.length) {
      bump(delta)
      return false
    }
    if (moving) return false
    if (reduced) {
      goTo(target)
      return true
    }
    moving = true
    track.style.transition = 'transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'
    track.style.transform = `translateX(calc(${-delta * direction * 100}% - ${delta * direction * GAP}px))`
    const finish = () => {
      track.removeEventListener('transitionend', finish)
      clearTimeout(fallback)
      track.style.transition = 'none'
      track.style.transform = ''
      goTo(target)
      // Let the jump back land before the next move animates.
      requestAnimationFrame(() => {
        track.style.transition = ''
        moving = false
      })
    }
    const fallback = setTimeout(finish, 400)
    track.addEventListener('transitionend', finish)
    return true
  }

  function snapBack () {
    track.style.transition = reduced ? 'none' : 'transform 220ms ease-out'
    track.style.transform = ''
  }

  // Zoom, kept with the point under the pointer still.
  function fitted (slide) {
    const box = stage.getBoundingClientRect()
    const picture = slide.picture
    const width = picture && picture.naturalWidth
    const height = picture && picture.naturalHeight
    if (!width || !height) return { width: box.width, height: box.height, box }
    const scale = Math.min(box.width / width, box.height / height)
    return { width: width * scale, height: height * scale, box }
  }

  function clampPan (slide) {
    const { width, height, box } = fitted(slide)
    const { scale } = slide.zoom
    const maxX = Math.max(0, (width * scale - box.width) / 2)
    const maxY = Math.max(0, (height * scale - box.height) / 2)
    slide.zoom.x = scale <= 1 ? 0 : clamp(slide.zoom.x, -maxX, maxX)
    slide.zoom.y = scale <= 1 ? 0 : clamp(slide.zoom.y, -maxY, maxY)
  }

  function applyZoom (slide, animate) {
    if (!slide.box) return
    const { scale, x, y } = slide.zoom
    slide.box.style.transition = animate && !reduced ? 'transform 220ms ease' : 'none'
    slide.box.style.transform = scale === 1 && !x && !y ? '' : `translate(${x}px, ${y}px) scale(${scale})`
    root.classList.toggle('is-zoomed', scale > 1.01)
  }

  function zoomTo (slide, nextScale, clientX, clientY, animate = true) {
    if (!slide || slide.kind !== 'image' || !slide.picture) return
    const box = stage.getBoundingClientRect()
    const px = (clientX ?? box.left + box.width / 2) - box.left - box.width / 2
    const py = (clientY ?? box.top + box.height / 2) - box.top - box.height / 2
    const { scale, x, y } = slide.zoom
    const next = clamp(nextScale, 1, MAX_ZOOM)
    slide.zoom = { scale: next, x: px - ((px - x) / scale) * next, y: py - ((py - y) / scale) * next }
    clampPan(slide)
    applyZoom(slide, animate)
  }

  function resetZoom (slide, animate = true) {
    if (!slide) return
    slide.zoom = { scale: 1, x: 0, y: 0 }
    applyZoom(slide, animate)
  }

  // Pointers: swipe between items, drag down to close, pan when zoomed,
  // pinch with two fingers, double tap to zoom.
  const pointers = new Map()
  let gesture = null
  let lastTap = null
  let tapTimer = null
  let pressTimer = null

  function onPointerDown (event) {
    if (event.button > 0 || closed) return
    if (event.target.closest('button, a, .hd-lb-cannot')) return
    const slide = current()
    if (slide && slide.video) {
      const box = slide.video.getBoundingClientRect()
      if (event.clientY > box.bottom - 64 && event.clientY <= box.bottom) return
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try {
      stage.setPointerCapture(event.pointerId)
    } catch {}
    stopSlideshow()
    if (pointers.size === 1) {
      gesture = {
        type: slide && slide.zoom.scale > 1 ? 'pan' : 'pending',
        x0: event.clientX,
        y0: event.clientY,
        zx: slide ? slide.zoom.x : 0,
        zy: slide ? slide.zoom.y : 0,
        lastX: event.clientX,
        lastY: event.clientY,
        lastT: performance.now(),
        vx: 0,
        vy: 0,
        pointerType: event.pointerType
      }
      if (slide && slide.playLive && event.pointerType === 'touch') {
        pressTimer = setTimeout(() => {
          gesture.type = 'press'
          slide.playLive(true)
        }, 350)
      }
    } else if (pointers.size === 2 && slide && slide.kind === 'image') {
      clearTimeout(pressTimer)
      snapBack()
      const [a, b] = [...pointers.values()]
      gesture = {
        type: 'pinch',
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        scale: slide.zoom.scale,
        zx: slide.zoom.x,
        zy: slide.zoom.y
      }
    }
  }

  function onPointerMove (event) {
    const point = pointers.get(event.pointerId)
    if (!point || !gesture) return
    point.x = event.clientX
    point.y = event.clientY
    const slide = current()
    if (gesture.type === 'pinch') {
      if (pointers.size < 2) return
      const [a, b] = [...pointers.values()]
      const box = stage.getBoundingClientRect()
      const centerX = box.left + box.width / 2
      const centerY = box.top + box.height / 2
      const scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, 0.7, MAX_ZOOM)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const ox = (gesture.midX - centerX - gesture.zx) / gesture.scale
      const oy = (gesture.midY - centerY - gesture.zy) / gesture.scale
      slide.zoom = { scale, x: midX - centerX - ox * scale, y: midY - centerY - oy * scale }
      applyZoom(slide, false)
      return
    }
    const now = performance.now()
    const elapsed = Math.max(1, now - gesture.lastT)
    gesture.vx = (event.clientX - gesture.lastX) / elapsed
    gesture.vy = (event.clientY - gesture.lastY) / elapsed
    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
    gesture.lastT = now
    const dx = event.clientX - gesture.x0
    const dy = event.clientY - gesture.y0
    if (gesture.type === 'press') return
    if (gesture.type === 'pending') {
      if (Math.hypot(dx, dy) < 8) return
      clearTimeout(pressTimer)
      if (Math.abs(dx) > Math.abs(dy)) gesture.type = 'swipe'
      else if (dy > 0) gesture.type = 'dismiss'
      else gesture.type = 'none'
      track.style.transition = 'none'
    }
    if (gesture.type === 'swipe') {
      const towardsNext = dx * direction < 0
      const blocked = towardsNext ? index === items.length - 1 : index === 0
      track.style.transform = `translateX(${blocked ? dx * 0.3 : dx}px)`
    } else if (gesture.type === 'dismiss') {
      const pull = Math.max(0, dy)
      slide.element.style.transition = 'none'
      slide.element.style.transform = `translate(${dx * 0.4}px, ${pull}px) scale(${1 - Math.min(pull / 1800, 0.2)})`
      root.style.setProperty('--hd-lb-fade', String(Math.max(0.2, 1 - pull / 420)))
    } else if (gesture.type === 'pan' && slide) {
      slide.zoom.x = gesture.zx + dx
      slide.zoom.y = gesture.zy + dy
      clampPan(slide)
      applyZoom(slide, false)
    }
  }

  function onPointerUp (event) {
    if (!pointers.has(event.pointerId)) return
    pointers.delete(event.pointerId)
    clearTimeout(pressTimer)
    const slide = current()
    if (!gesture) return
    if (gesture.type === 'pinch') {
      if (pointers.size >= 2) return
      if (slide.zoom.scale < 1.05) resetZoom(slide)
      else {
        clampPan(slide)
        applyZoom(slide, true)
      }
      const rest = [...pointers.values()][0]
      gesture = rest ? { type: 'pan', x0: rest.x, y0: rest.y, zx: slide.zoom.x, zy: slide.zoom.y, lastX: rest.x, lastY: rest.y, lastT: performance.now(), vx: 0, vy: 0 } : null
      return
    }
    if (pointers.size) return
    const dx = event.clientX - gesture.x0
    const dy = event.clientY - gesture.y0
    const kind = gesture.type
    const { vx, vy, pointerType } = gesture
    gesture = null
    if (kind === 'press') {
      if (slide && slide.stopLive) slide.stopLive()
      return
    }
    if (kind === 'swipe') {
      const width = stage.clientWidth
      const forward = dx * direction < 0
      const far = Math.abs(dx) > width * 0.18 || Math.abs(vx) > 0.45
      track.style.transition = ''
      if (!far || !step(forward ? 1 : -1)) snapBack()
      return
    }
    if (kind === 'dismiss') {
      if (dy > 110 || vy > 0.6) {
        close()
        return
      }
      slide.element.style.transition = reduced ? 'none' : 'transform 220ms ease'
      slide.element.style.transform = ''
      root.style.removeProperty('--hd-lb-fade')
      position()
      return
    }
    if (kind === 'pending') tapped(event, pointerType)
  }

  function tapped (event, pointerType) {
    const now = performance.now()
    const slide = current()
    if (lastTap && now - lastTap.time < 300 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 30) {
      clearTimeout(tapTimer)
      lastTap = null
      if (slide && slide.kind === 'image') {
        if (slide.zoom.scale > 1.05) resetZoom(slide)
        else zoomTo(slide, 2.5, event.clientX, event.clientY)
      }
      return
    }
    lastTap = { time: now, x: event.clientX, y: event.clientY }
    if (pointerType === 'touch') {
      clearTimeout(tapTimer)
      tapTimer = setTimeout(() => root.classList.toggle('is-chrome-hidden'), 300)
    }
  }

  function onWheel (event) {
    const slide = current()
    if (!slide || slide.kind !== 'image') return
    event.preventDefault()
    stopSlideshow()
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002))
    zoomTo(slide, slide.zoom.scale * factor, event.clientX, event.clientY, false)
  }

  // Details: when, with what, how big, where.
  async function renderInfo () {
    const entry = item()
    const shownFor = entry
    const kind = itemKind(entry)
    const rows = []
    const row = (iconName, main, sub, extra) => h('div', { class: 'hd-lb-info-row' },
      h('span', { class: 'hd-lb-info-icon' }, icon(iconName)),
      h('div', { class: 'hd-lb-info-text' },
        h('div', { class: 'hd-lb-info-main' }, main),
        sub ? h('div', { class: 'hd-lb-info-sub' }, sub) : null,
        extra || null))
    replace(infoBody, h('div', { class: 'hd-spinner hd-lb-info-wait', 'aria-label': t('Loading') }))

    let meta = null
    let when = null
    try {
      meta = kind === 'video'
        ? await thumbs.videoMeta(entry, { signal: lifetime.signal })
        : await thumbs.imageMeta(entry, { signal: lifetime.signal })
      when = await thumbs.takenAt(entry, { entries: ctx.listing && ctx.listing.entries, signal: lifetime.signal })
    } catch {}
    if (closed || item() !== shownFor) return
    meta = meta || {}

    if (when && Number.isFinite(when.ms)) {
      const day = formatDate(when.ms, { utc: when.utc, style: 'dayYear' })
      const time = formatDate(when.ms, { utc: when.utc, style: 'time' })
      const note = when.source === 'mtime' ? t('Added to the drive') : when.source === 'name' ? t('From the file name') : null
      rows.push(row('calendar', day, note ? `${time} · ${note}` : time))
    }

    if (kind === 'image') {
      const camera = cameraName(meta.make, meta.model)
      const settings = [
        meta.fNumber ? t('f/{value}', { value: formatNumber(meta.fNumber, { maximumFractionDigits: 1 }) }) : '',
        exposureText(meta.exposureTime),
        meta.iso ? t('ISO {value}', { value: formatNumber(meta.iso) }) : '',
        meta.focalLength ? t('{value} mm', { value: formatNumber(meta.focalLength, { maximumFractionDigits: 1 }) }) : ''
      ].filter(Boolean).join(' · ')
      if (camera || settings) rows.push(row('camera', camera || t('Camera'), settings, meta.lens ? h('div', { class: 'hd-lb-info-sub' }, meta.lens) : null))
    }

    const facts = []
    if (meta.width && meta.height) {
      const turned = meta.orientation >= 5 && meta.orientation <= 8
      const width = turned ? meta.height : meta.width
      const height = turned ? meta.width : meta.height
      facts.push(t('{width} × {height}', { width: formatNumber(width), height: formatNumber(height) }))
      if (kind === 'image') facts.push(t('{value} MP', { value: formatNumber((width * height) / 1e6, { maximumFractionDigits: 1 }) }))
    }
    if (kind === 'video' && Number.isFinite(meta.duration)) facts.push(formatDuration(meta.duration))
    if (entry.size) facts.push(formatBytes(entry.size))
    rows.push(row(kind === 'video' ? 'video' : 'image', shownName(entry.path), facts.join(' · ')))

    const folder = parentPath(entry.path)
    const folderButton = h('button', {
      type: 'button',
      class: 'hd-link-btn',
      onClick: () => {
        close()
        ctx.navigate({ view: 'files', path: folder })
      }
    }, folderTitle(host, folder))
    rows.push(row('folder', folderButton, folder === '/' ? null : folder))

    const gps = meta.gps
    if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lon)) {
      const coordinates = `${formatNumber(gps.lat, { maximumFractionDigits: 5 })}, ${formatNumber(gps.lon, { maximumFractionDigits: 5 })}`
      const placeRow = row('pin', t('Finding the place...'), coordinates)
      rows.push(placeRow)
      placesTable().then((table) => {
        if (closed || item() !== shownFor) return
        const place = table ? nearestPlace(table, gps.lat, gps.lon, { maxKm: 60 }) : null
        const main = placeRow.querySelector('.hd-lb-info-main')
        if (!main) return
        const country = place && place.country ? regionName(place.country) : ''
        main.textContent = place ? (country ? t('{place}, {country}', { place: place.name, country }) : place.name) : t('Unknown place')
      })
    }

    if (closed || item() !== shownFor) return
    replace(infoBody, rows, h('p', { class: 'hd-lb-info-foot' }, t('Read from the file on this device.')))
  }

  function toggleInfo (force) {
    infoOpen = force === undefined ? !infoOpen : force
    root.classList.toggle('is-info-open', infoOpen)
    infoButton.setAttribute('aria-pressed', String(infoOpen))
    if (infoOpen) renderInfo()
    const slide = current()
    if (slide) {
      clampPan(slide)
      applyZoom(slide, false)
    }
  }

  function stopSlideshow () {
    if (!slideshowTimer) return
    clearInterval(slideshowTimer)
    slideshowTimer = null
    slideshowButton.setAttribute('aria-pressed', 'false')
    root.classList.remove('is-slideshow')
  }

  function toggleSlideshow () {
    if (slideshowTimer) {
      stopSlideshow()
      return
    }
    if (index >= items.length - 1) goTo(0)
    slideshowButton.setAttribute('aria-pressed', 'true')
    root.classList.add('is-slideshow')
    slideshowTimer = setInterval(() => {
      const slide = current()
      if (slide && slide.video && !slide.video.paused) return
      if (index >= items.length - 1) stopSlideshow()
      else step(1)
    }, SLIDESHOW_MS)
  }

  function download () {
    const entry = item()
    source.download(host, entry.path, nameOf(entry.path))
    if (source.platform === 'desktop') toast(t('Download started'))
  }

  function copyLink () {
    copyWithToast(source, source.hyperUrl(host, item().path))
  }

  async function share () {
    const entry = item()
    const result = await source.share(host, entry.path, nameOf(entry.path))
    if (result === 'copied') toast(t('Link copied'))
  }

  function openOriginal () {
    source.open(host, item().path)
  }

  function openMore () {
    openMenu(moreButton, [
      items.length > 1 ? { label: slideshowTimer ? t('Stop slideshow') : t('Slideshow'), icon: 'slideshow', onSelect: toggleSlideshow } : null,
      { label: t('Download'), icon: 'download', onSelect: download },
      { label: t('Copy link'), icon: 'link', onSelect: copyLink },
      phone ? { label: t('Share'), icon: 'share', onSelect: share } : null,
      { label: t('Open original'), icon: 'external', onSelect: openOriginal }
    ], { label: t('More') })
  }

  function onKey (event) {
    if (closed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    const slide = current()
    const inVideo = event.target && event.target.tagName === 'VIDEO'
    const key = event.key
    if (key === 'Escape') {
      event.preventDefault()
      if (slide && slide.zoom.scale > 1.01) resetZoom(slide)
      else close()
      return
    }
    if (event.target && event.target.closest && event.target.closest('.hd-menu')) return
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      if (inVideo) return
      event.preventDefault()
      stopSlideshow()
      step((key === 'ArrowRight' ? 1 : -1) * direction)
    } else if (key === 'Home' || key === 'End') {
      event.preventDefault()
      goTo(key === 'Home' ? 0 : items.length - 1)
    } else if (key === 'i' || key === 'I') {
      toggleInfo()
    } else if (key === '+' || key === '=') {
      zoomTo(slide, (slide ? slide.zoom.scale : 1) * 1.5)
    } else if (key === '-' || key === '_') {
      zoomTo(slide, (slide ? slide.zoom.scale : 1) / 1.5)
    } else if (key === '0') {
      resetZoom(slide)
    } else if (key === 's' || key === 'S') {
      if (items.length > 1) toggleSlideshow()
    } else if (key === ' ' || key === 'Spacebar') {
      if (inVideo || (event.target && event.target.tagName === 'BUTTON')) return
      event.preventDefault()
      if (slide && slide.video) {
        if (slide.video.paused) slide.video.play().catch(() => {})
        else slide.video.pause()
      } else if (items.length > 1) {
        toggleSlideshow()
      }
    } else if (key === 'Tab') {
      const focusable = [...root.querySelectorAll('button:not([disabled]), video[controls]')]
        .filter((node) => !node.closest('[inert]') && node.getClientRects().length)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  // The controls fade after a still mouse, never on a touch screen, where a
  // tap shows and hides them: iOS sends a mousemove after every tap.
  function onMouseMove (event) {
    if (event && event.pointerType !== 'mouse') return
    root.classList.remove('is-idle')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!topBar.matches(':hover') && !infoPanel.matches(':hover')) root.classList.add('is-idle')
    }, 2600)
  }

  function close () {
    if (closed) return
    closed = true
    closeMenu()
    stopSlideshow()
    clearTimeout(idleTimer)
    clearTimeout(tapTimer)
    clearTimeout(pressTimer)
    lifetime.abort()
    document.removeEventListener('keydown', onKey, true)
    root.classList.remove('is-open')
    document.documentElement.classList.remove('hd-no-scroll')
    for (const slide of slides.values()) {
      if (slide.video) slide.video.pause()
      if (slide.stopLive) slide.stopLive()
    }
    setTimeout(() => {
      for (const slide of slides.values()) dispose(slide)
      slides.clear()
      root.remove()
    }, reduced ? 0 : 200)
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true })
    if (options.onClose) options.onClose()
  }

  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  stage.addEventListener('pointercancel', onPointerUp)
  stage.addEventListener('wheel', onWheel, { passive: false })
  stage.addEventListener('dblclick', (event) => event.preventDefault())
  root.addEventListener('pointermove', onMouseMove)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', () => {
    const slide = current()
    if (slide && !closed) {
      clampPan(slide)
      applyZoom(slide, false)
    }
  }, { signal: lifetime.signal })

  // On a narrow screen the details come up from the bottom, and the photo
  // moves into the room above them, as it moves aside on a wide screen.
  const sheet = new ResizeObserver(() => root.style.setProperty('--hd-lb-sheet', infoPanel.offsetHeight + 'px'))
  sheet.observe(infoPanel)
  lifetime.signal.addEventListener('abort', () => sheet.disconnect())

  document.body.append(root)
  document.documentElement.classList.add('hd-no-scroll')
  goTo(index)
  requestAnimationFrame(() => {
    root.classList.add('is-open')
    root.focus({ preventScroll: true })
  })
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) onMouseMove()
  if (options.slideshow && items.length > 1) toggleSlideshow()

  return {
    element: root,
    close,
    goTo,
    get index () {
      return index
    },
    get closed () {
      return closed
    }
  }
}

/** True for files the lightbox shows: images, RAW photos and videos. */
export function isLightboxKind (path, size) {
  const kind = kindOf(path, size)
  return kind === 'image' || kind === 'raw' || kind === 'video'
}
