/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { h, icon, iconButton, button, toast, replace, closeMenu } from '/hyperdrive/viewer/ui.js'
import { t, formatDuration, languageName, getLanguage } from '/hyperdrive/viewer/i18n.js'
import { extensionOf } from '/hyperdrive/viewer/lib/kinds.js'
import { cleanTitle } from '/hyperdrive/viewer/lib/names.js'
import { srtToVtt, subtitlesFor } from '/hyperdrive/viewer/lib/subtitles.js'

// A video over everything else: the engine's own controls, subtitles found
// next to the file, resume where it was left, progress kept every 5 s, the
// next episode offered 10 s before the end, and plain words when this
// engine cannot play the file.

const SAVE_EVERY = 5000
const UP_NEXT_AT = 10
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024
const MAX_TRACKS = 12

const MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ogv: 'video/ogg',
  '3gp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ts: 'video/mp2t',
  mts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg'
}
// Engines often play these though canPlayType says no (H.264 in a .mov or
// .mkv), so they are tried and judged by what happens.
const TRY_ANYWAY = new Set(['mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'ogv', '3gp'])

let preferredSubtitle = null

/** False when this engine will certainly not play a file of this kind. */
export function canPlay (path) {
  const extension = extensionOf(path)
  const type = MIME[extension]
  if (!type) return false
  const probe = document.createElement('video')
  return Boolean(probe.canPlayType(type)) || TRY_ANYWAY.has(extension)
}

function subtitleLabel (sub, index) {
  const base = (sub.language && languageName(sub.language)) || sub.label || t('Subtitles {number}', { number: index + 1 })
  if (sub.forced) return t('{language} (forced)', { language: base })
  if (sub.sdh) return t('{language} (SDH)', { language: base })
  return base
}

/**
 * Opens the player.
 * options: {
 *   title, subtitle: the words at the top (default: the cleaned file name),
 *   next: { entry, title, subtitle } or (entry) => that or null, for Up Next,
 *   resume: false to start at the beginning without asking, 'auto' to pick
 *     up where it was left without asking (the person pressed Resume),
 *   onChange(entry): Up Next moved to another video,
 *   onClose()
 * }
 * Returns { close(), element }.
 */
export function openPlayer (ctx, entry, options = {}) {
  const { source, store } = ctx
  const host = ctx.route.host
  const entries = (ctx.listing && ctx.listing.entries) || []
  const previousFocus = document.activeElement
  let closed = false
  let current = null
  let lastSave = 0
  let upNextDismissed = false
  let upNextShown = false
  let trackUrls = []
  let wantedTrack = null
  let load = null

  const video = h('video', { class: 'hd-player-video', controls: true, playsinline: true, 'webkit-playsinline': true, preload: 'metadata' })
  const titleLine = h('strong', { class: 'hd-player-title' })
  const subtitleLine = h('span', { class: 'hd-player-subtitle' })
  const notice = h('div', { class: 'hd-player-notice', role: 'status', hidden: true })
  const overlayCard = h('div', { class: 'hd-player-card', hidden: true })
  const upNext = h('div', { class: 'hd-player-upnext', hidden: true, role: 'region', 'aria-label': t('Up next') })
  const errorPanel = h('div', { class: 'hd-player-error', hidden: true })
  const fullscreenButton = iconButton('fullscreen', t('Full screen'), () => toggleFullscreen(), { className: 'hd-player-wide' })

  const root = h('div', { class: 'hd-player', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Video player'), tabindex: '-1' },
    h('div', { class: 'hd-player-stage' }, video),
    h('div', { class: 'hd-player-top' },
      iconButton('close', t('Close'), () => close(), { className: 'hd-player-close' }),
      h('div', { class: 'hd-player-titles' }, titleLine, subtitleLine),
      h('div', { class: 'hd-player-actions' },
        iconButton('download', t('Download'), () => source.download(host, current.path, current.path.split('/').pop()), { className: 'hd-player-wide' }),
        iconButton('external', t('Open in new tab'), () => source.open(host, current.path), { className: 'hd-player-wide' }),
        fullscreenButton)),
    notice, overlayCard, upNext, errorPanel)

  const keyOf = (item) => store.keyOf(item)

  function nextFor (item) {
    const next = typeof options.next === 'function' ? options.next(item) : (item === entry ? options.next : null)
    return next && next.entry ? next : null
  }

  function saveProgress (force) {
    if (!current || !Number.isFinite(video.duration) || video.duration <= 0) return
    const now = Date.now()
    if (!force && now - lastSave < SAVE_EVERY) return
    lastSave = now
    const position = video.currentTime
    const duration = video.duration
    const done = video.ended || position >= duration - Math.max(30, duration * 0.05)
    store.putProgress(keyOf(current), {
      path: current.path,
      size: current.size,
      mtime: current.mtime,
      position: done ? 0 : position,
      duration,
      done,
      title: titleLine.textContent
    }).catch(() => {})
  }

  function showError (title, text) {
    video.pause()
    errorPanel.hidden = false
    root.classList.add('has-error')
    replace(errorPanel,
      h('div', { class: 'hd-player-error-icon' }, icon('alert')),
      h('p', { class: 'hd-player-error-title' }, title),
      h('p', { class: 'hd-player-error-text' }, text),
      h('div', { class: 'hd-player-error-actions' },
        button({ label: t('Download'), icon: 'download', variant: 'primary', onClick: () => source.download(host, current.path, current.path.split('/').pop()) }),
        button({ label: t('Open in new tab'), icon: 'external', variant: 'overlay', onClick: () => source.open(host, current.path) })))
  }

  async function addSubtitles (item, signal) {
    let found = []
    try {
      found = (await subtitlesFor(item.path, entries)) || []
    } catch {
      found = []
    }
    const playable = found.filter((sub) => sub && (sub.format === 'srt' || sub.format === 'vtt'))
    const language = getLanguage().split('-')[0]
    playable.sort((a, b) => Number(b.language === language) - Number(a.language === language))
    let chosen = false
    for (const [index, sub] of playable.slice(0, MAX_TRACKS).entries()) {
      if (signal.aborted) return
      let text
      try {
        text = await source.text(host, sub.path, { maxBytes: MAX_SUBTITLE_BYTES, signal })
      } catch {
        continue
      }
      if (signal.aborted) return
      const vtt = sub.format === 'srt' ? srtToVtt(text) : (/^\s*WEBVTT/.test(text) ? text : `WEBVTT\n\n${text}`)
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
      trackUrls.push(url)
      const label = subtitleLabel(sub, index)
      // The track picked last time (by its label, which says the language
      // and forced or SDH), else forced subtitles in the page's language.
      const isDefault = !chosen && (
        (preferredSubtitle && preferredSubtitle === label) ||
        (!preferredSubtitle && sub.forced && sub.language === language))
      if (isDefault) {
        chosen = true
        wantedTrack = label
      }
      const track = h('track', { kind: 'subtitles', label, srclang: sub.language || null, src: url, default: isDefault })
      video.append(track)
      showWantedTrack()
    }
  }

  // The engine picks subtitles by itself as tracks are added and the video
  // loads, sometimes turning on several. Only the one wanted shows.
  function showWantedTrack () {
    for (const textTrack of video.textTracks) {
      const mode = wantedTrack && textTrack.label === wantedTrack ? 'showing' : 'disabled'
      if (textTrack.mode !== mode) textTrack.mode = mode
    }
  }

  function clearTracks () {
    for (const track of video.querySelectorAll('track')) track.remove()
    for (const url of trackUrls) URL.revokeObjectURL(url)
    trackUrls = []
  }

  function askToResume (position) {
    overlayCard.hidden = false
    const resumeButton = button({
      label: t('Resume from {time}', { time: formatDuration(position) }),
      icon: 'play',
      variant: 'primary',
      onClick: () => start(position)
    })
    replace(overlayCard,
      h('p', { class: 'hd-player-card-title' }, t('Pick up where you left off?')),
      h('div', { class: 'hd-player-card-actions' },
        resumeButton,
        button({ label: t('Start over'), variant: 'overlay', onClick: () => start(0) })))
    requestAnimationFrame(() => resumeButton.focus({ preventScroll: true }))
  }

  function start (position) {
    const fromCard = !overlayCard.hidden && overlayCard.contains(document.activeElement)
    overlayCard.hidden = true
    // The keys stay with the player once the card is gone.
    if (fromCard) video.focus({ preventScroll: true })
    const go = () => {
      if (position > 0) {
        try {
          video.currentTime = position
        } catch {}
      }
      video.play().catch(() => {})
    }
    if (video.readyState >= 1) go()
    else video.addEventListener('loadedmetadata', go, { once: true })
  }

  function showUpNext (next) {
    upNextShown = true
    upNext.hidden = false
    const picture = h('img', { class: 'hd-player-upnext-img', alt: '' })
    ctx.thumbs.video(next.entry, { size: 'grid', entries, prefer: 'frame' }).then((url) => {
      if (url) picture.setAttribute('src', url)
    }, () => {})
    replace(upNext,
      h('div', { class: 'hd-player-upnext-frame' }, picture, h('span', { class: 'hd-player-upnext-play' }, icon('play'))),
      h('div', { class: 'hd-player-upnext-text' },
        h('span', { class: 'hd-player-upnext-label' }, t('Up next')),
        h('strong', null, next.title || cleanTitle(next.entry.path.split('/').pop())),
        next.subtitle ? h('span', null, next.subtitle) : null,
        h('div', { class: 'hd-player-upnext-actions' },
          button({ label: t('Play now'), icon: 'play', variant: 'primary', small: true, onClick: () => playItem(next.entry, next) }),
          button({ label: t('Cancel'), variant: 'overlay', small: true, onClick: hideUpNext }))))
  }

  function hideUpNext () {
    upNextDismissed = true
    upNext.hidden = true
  }

  async function playItem (item, info = {}) {
    if (load) load.abort()
    if (current) saveProgress(true)
    load = new AbortController()
    const signal = load.signal
    current = item
    lastSave = 0
    upNextDismissed = false
    upNextShown = false
    upNext.hidden = true
    overlayCard.hidden = true
    errorPanel.hidden = true
    notice.hidden = true
    root.classList.remove('has-error')
    clearTracks()
    wantedTrack = null
    const name = item.path.split('/').pop()
    titleLine.textContent = info.title || cleanTitle(name) || name
    subtitleLine.textContent = info.subtitle || ''
    root.setAttribute('aria-label', titleLine.textContent)
    if (item !== entry && options.onChange) options.onChange(item)

    if (!canPlay(item.path)) {
      video.removeAttribute('src')
      showError(t("This video can't play here"), t('Download it to watch it in another app, or open it in a new tab.'))
      return
    }

    let saved = null
    if (options.resume !== false) {
      saved = await store.getProgress(keyOf(item)).catch(() => null)
      if (signal.aborted) return
    }
    video.setAttribute('src', source.fileUrl(host, item.path))
    addSubtitles(item, signal)
    const position = saved && !saved.done && Number(saved.position) > 15 && Number(saved.position) < Number(saved.duration) - 20 ? Number(saved.position) : 0
    if (position && options.resume === 'auto' && item === entry) start(position)
    else if (position) askToResume(position)
    else start(0)
  }

  video.addEventListener('timeupdate', () => {
    saveProgress(false)
    const remaining = video.duration - video.currentTime
    const next = current && nextFor(current)
    // 10 s before the end, or in the last third of a short video.
    if (next && !upNextDismissed && !upNextShown && Number.isFinite(remaining) && remaining <= Math.min(UP_NEXT_AT, video.duration / 3)) {
      showUpNext(next)
    }
  })
  video.addEventListener('pause', () => saveProgress(true))
  video.addEventListener('ended', () => {
    saveProgress(true)
    const next = current && nextFor(current)
    if (next && !upNextDismissed) playItem(next.entry, next)
  })
  video.addEventListener('error', () => {
    if (!video.getAttribute('src') || closed) return
    showError(t("This video can't play here"), t('Download it to watch it in another app, or open it in a new tab.'))
  })
  video.addEventListener('loadeddata', () => {
    // Sound with no picture: a codec this engine does not draw.
    if (!video.videoWidth && !video.videoHeight) {
      notice.hidden = false
      notice.textContent = t("This video's picture can't be shown here, only its sound.")
    }
  })
  video.addEventListener('loadeddata', () => showWantedTrack())
  // One track showing is a choice (the CC menu, the c key) and is kept for
  // the next video; more than one is the engine's doing and is undone.
  video.textTracks.addEventListener('change', () => {
    const showing = [...video.textTracks].filter((track) => track.mode === 'showing')
    if (showing.length > 1) {
      showWantedTrack()
      return
    }
    wantedTrack = showing.length ? showing[0].label : null
    if (video.textTracks.length) preferredSubtitle = wantedTrack
  })

  function toggleFullscreen () {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else if (root.requestFullscreen) {
      root.requestFullscreen().catch(() => {})
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen()
    }
  }

  function onKey (event) {
    if (closed || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    const target = event.target && event.target.nodeType === 1 ? event.target : null
    const onButton = target && (target.tagName === 'BUTTON' || target.closest('.hd-menu'))
    const onVideo = target === video
    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        if (onButton || (onVideo && event.key === ' ')) return
        event.preventDefault()
        if (video.paused) video.play().catch(() => {})
        else video.pause()
        break
      case 'f':
      case 'F':
        event.preventDefault()
        toggleFullscreen()
        break
      case 'm':
      case 'M':
        event.preventDefault()
        video.muted = !video.muted
        toast(video.muted ? t('Sound off') : t('Sound on'), { duration: 1200 })
        break
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'j':
      case 'l':
        if (onVideo && event.key.startsWith('Arrow')) return
        event.preventDefault()
        try {
          const jump = event.key === 'j' || event.key === 'l' ? 10 : 5
          const sign = event.key === 'ArrowRight' || event.key === 'l' ? 1 : -1
          video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + sign * jump))
        } catch {}
        break
      case 'ArrowUp':
      case 'ArrowDown':
        if (onVideo) return
        event.preventDefault()
        video.volume = Math.max(0, Math.min(1, video.volume + (event.key === 'ArrowUp' ? 0.1 : -0.1)))
        break
      case 'c':
      case 'C': {
        const tracks = [...video.textTracks]
        if (!tracks.length) return
        const showing = tracks.findIndex((track) => track.mode === 'showing')
        tracks.forEach((track) => { track.mode = 'disabled' })
        const next = showing === -1 ? 0 : showing + 1
        if (next < tracks.length) {
          tracks[next].mode = 'showing'
          toast(tracks[next].label || t('Subtitles on'), { duration: 1400 })
        } else {
          toast(t('Subtitles off'), { duration: 1400 })
        }
        break
      }
      case 'Tab': {
        const focusable = [...root.querySelectorAll('button:not([disabled]), video[controls]')]
          .filter((node) => !node.closest('[hidden]') && node.getClientRects().length)
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
        break
      }
      default:
        break
    }
  }

  function close () {
    if (closed) return
    closed = true
    closeMenu()
    if (load) load.abort()
    saveProgress(true)
    video.pause()
    clearTimeout(idleTimer)
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('keydown', onKey, true)
    if (document.fullscreenElement === root) document.exitFullscreen().catch(() => {})
    root.classList.remove('is-open')
    document.documentElement.classList.remove('hd-no-scroll')
    setTimeout(() => {
      video.removeAttribute('src')
      try {
        video.load()
      } catch {}
      clearTracks()
      root.remove()
    }, 200)
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true })
    if (options.onClose) options.onClose()
  }

  // The top bar fades while a video plays and nobody moves.
  let idleTimer = null
  const wake = () => {
    root.classList.remove('is-idle')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => root.classList.add('is-idle'), 3000)
  }
  root.addEventListener('pointermove', wake)
  root.addEventListener('pointerdown', wake)
  root.addEventListener('keydown', wake)
  video.addEventListener('play', () => {
    root.classList.add('is-playing')
    wake()
  })
  video.addEventListener('pause', () => root.classList.remove('is-playing', 'is-idle'))
  const onPageHide = () => saveProgress(true)
  window.addEventListener('pagehide', onPageHide)

  if (!document.fullscreenEnabled && !video.webkitEnterFullscreen) fullscreenButton.hidden = true
  document.addEventListener('keydown', onKey, true)
  document.body.append(root)
  document.documentElement.classList.add('hd-no-scroll')
  requestAnimationFrame(() => {
    root.classList.add('is-open')
    root.focus({ preventScroll: true })
  })
  playItem(entry, { title: options.title, subtitle: options.subtitle })

  return {
    element: root,
    video,
    close,
    get current () {
      return current
    },
    get closed () {
      return closed
    }
  }
}
