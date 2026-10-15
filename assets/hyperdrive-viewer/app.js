/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
/**
 * The Hyperdrive viewer's shell: reads the address, lists the folder, picks
 * a view, and mounts files.js, photos.js or videos.js under a top bar.
 *
 * ## What a view gets
 *
 * Each view module exports
 *
 *     export function mount (ctx) {
 *       // build into ctx.root
 *       return { unmount () {}, onHash (hash) {} } // both optional; may be async
 *     }
 *
 * and ctx holds:
 *
 * - root: the <main> element to build in, empty. The top bar is above it
 *   (its height is the CSS variable --hd-bar-h, safe area included).
 * - source: source.js. platform ('desktop' | 'ios' | 'android'), config
 *   ({ language, strings, dark, incognito, epoch, safeArea }), list(),
 *   fileUrl(host, path) for <img>/<video>/fetch (on the phone it carries the
 *   server's token: never show, copy or share it), hyperUrl(host, path) to
 *   show and share, read(host, path, start, end, { signal }), text(host,
 *   path, { maxBytes, signal }), download(host, path, name), open(host,
 *   path), openExternal(url), copy(text), share(host, path, name),
 *   post(message).
 * - route: { view, host, path, hash }. path is a folder ('/a/b/'); hash is
 *   the fragment as an object (#places&album=/2024/ is { places: true,
 *   album: '/2024/' }). It is kept current as the fragment changes.
 * - listing: { entries: [{ path, size, mtime }], truncated, private,
 *   writable }: every file under route.path, recursively, paths absolute in
 *   the drive. mtime is milliseconds or null. Junk is still in; kinds.js'
 *   isJunk() tells it.
 * - classification: classify(entries, route.path) from lib/kinds.js:
 *   { view, counts: { image, video, audio, other, junk, sidecar }, hasSite,
 *   others }.
 * - store: store.js for this drive (memory only for a private drive or in
 *   incognito). keyOf(entry), getThumb/putThumb, getMeta/putMeta,
 *   getProgress/putProgress/deleteProgress, listProgress() (newest first;
 *   each value { path, size, mtime, position, duration, done, title }).
 * - thumbs: thumbs.js. photo(entry, { size: 'grid' | 'hero', signal,
 *   priority }) and video(entry, { size, entries, prefer: 'poster' | 'frame',
 *   signal, priority }) resolve to an object URL or null; attach(img, entry,
 *   { kind: 'photo' | 'video', size, entries, prefer, onResult }) fills an
 *   <img> once it is near the screen and returns a detach function;
 *   detachWithin(element) before emptying it; imageMeta(entry) (lib/exif.js),
 *   videoMeta(entry) (lib/video-meta.js), takenAt(entry, { entries }) ({ ms,
 *   utc: true, source }: a wall-clock time, so format it with timeZone
 *   'UTC'; source is exif, video, takeout, name, mtime or none), badge(entry)
 *   ('HEIC', 'RAW', 'TIFF'...), canShowOriginal(entry), queue(concurrency).
 *   priority: 'low' for background work such as reading every photo's date.
 *   See also VIEWER-API.md.
 * - t and tp: from i18n.js. t takes the English text and values; tp takes
 *   { one, other }, the count and values. Call them bare, with the English
 *   as one string literal on one line (the phone's scanner reads the source,
 *   comments too), or import them from /hyperdrive/viewer/i18n.js, which
 *   also has formatNumber, formatBytes, formatDuration, formatRuntime,
 *   formatDate(ms, { utc, style }), formatRelative, regionName,
 *   languageName, formatList, compareText, msg and tKey. ctx.i18n is that
 *   module.
 * - ui: ui.js. h(tag, props, ...children) (the only way to make elements:
 *   text stays text, URL attributes are checked), icon(name), button(),
 *   iconButton(), kindBadge(), kindLabel(), toast(), copyWithToast(),
 *   openMenu(), openSheet(), stateView(), skeleton(), lazyChunks() for long
 *   grids, debounce(), replace().
 * - navigate({ view, path, hash }, { replace }): another folder or view.
 *   view 'auto' lists the folder and picks the view the way ?auto does.
 * - setHash(hash, { push }): in-view state in the address (a tab, an open
 *   album). Back and Forward then call the view's onHash(hash).
 * - openLightbox(items, index, { onChange, onClose, slideshow, fromHash }):
 *   items [{ path, size, mtime, kind: 'image' | 'video', motion: entry }]
 *   (motion: a Live Photo's moving part). Puts #item=<path> in the address,
 *   so Back closes it.
 * - openPlayer(entry, { title, subtitle, next, resume, onChange, onClose,
 *   fromHash }): next is { entry, title, subtitle } or a function of the
 *   entry playing that returns one, for Up Next. Also #item=<path>.
 * - overlay(path, { fromHash, onPop }): the same #item= handling for a
 *   view's own dialog; returns { update(path), close() }. Pass fromHash:
 *   true when opening because the address already has the item (onHash, or
 *   a link that was opened), so no extra history entry is made.
 * - shell: setSubtitle(text) (the line under the folder name),
 *   setActions(...nodes) (buttons in the top bar), setMenuItems(items)
 *   (added to the top bar's menu: [{ label, icon, onSelect }]),
 *   setDark(true) (dark whatever the theme; Videos), setOverlayBar(true)
 *   (the bar floats over the top of the view, for a hero). All reset when
 *   the view unmounts.
 * - signal: aborts when the view unmounts.
 * - savedScroll: where the page was scrolled when this view was left.
 */
import { createSource } from '/hyperdrive/viewer/source.js'
import { openStore } from '/hyperdrive/viewer/store.js'
import * as i18n from '/hyperdrive/viewer/i18n.js'
import { setupI18n, t, tp, msg, tKey, textDirection, getLanguage, formatNumber } from '/hyperdrive/viewer/i18n.js'
import * as ui from '/hyperdrive/viewer/ui.js'
import { h, icon, iconButton, button, stateView, skeleton, openMenu, closeMenu, copyWithToast, toast, replace } from '/hyperdrive/viewer/ui.js'
import { parseRoute, folderPath, folderTitle, parentPath, routeHref, hyperHref, peerskyHref } from '/hyperdrive/viewer/route.js'

const VIEW_MODULES = {
  files: () => import('/hyperdrive/viewer/files.js'),
  photos: () => import('/hyperdrive/viewer/photos.js'),
  videos: () => import('/hyperdrive/viewer/videos.js')
}
const SLOW_AFTER = 8000
const LISTING_TTL = 60 * 1000

const ERRORS = {
  'not-found': { icon: 'folder', title: msg('Nothing here'), text: msg('This drive has no folder at this address. Check the link and try again.') },
  'no-peers': { icon: 'drive', title: msg('No one is sharing this drive right now'), text: msg('Nobody who has this drive is online. Try again when one of them is.') },
  private: { icon: 'lock', title: msg('This drive is private'), text: msg('Only the devices it belongs to can open it.') },
  timeout: { icon: 'clock', title: msg('This is taking too long'), text: msg('The drive did not answer in time. Try again in a moment.') },
  'too-large': { icon: 'raw', title: msg('This folder is too big to show'), text: msg('It has more files than the viewer can list. The raw listing still works.') },
  unknown: { icon: 'alert', title: msg('Something went wrong'), text: msg("The folder couldn't be opened. Try again in a moment.") },
  invalid: { icon: 'alert', title: msg("This isn't a drive address"), text: msg('Check the link and try again.') }
}

const VIEW_SWITCH = [
  { view: 'photos', icon: 'image', label: msg('Photos') },
  { view: 'videos', icon: 'film', label: msg('Videos') },
  { view: 'files', icon: 'folder', label: msg('Files') }
]

// The desktop's theme, as the upload page has it. Loaded before this
// page's own styles so they win where both say something.
function loadDesktopTheme () {
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'browser://theme/index.css'
    const own = document.querySelector('link[rel="stylesheet"]')
    const done = (loaded) => resolve(loaded)
    link.addEventListener('load', () => done(true), { once: true })
    link.addEventListener('error', () => done(false), { once: true })
    setTimeout(() => done(false), 800)
    if (own) own.before(link)
    else document.head.append(link)
  })
}

// Dark when the theme's text is light.
function themeIsDark () {
  const probe = document.createElement('span')
  probe.style.color = 'var(--browser-theme-text-color, #ffffff)'
  probe.hidden = true
  document.body.append(probe)
  const channels = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).map(Number)
  probe.remove()
  if (channels.length < 3) return true
  const [red, green, blue] = channels
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.5
}

const desktopTheme = window.location.protocol === 'peersky:' ? loadDesktopTheme() : null

boot().catch((error) => {
  console.error(error)
  document.documentElement.dataset.hdReady = '1'
  document.body.replaceChildren(stateView({ icon: 'alert', title: tKey(ERRORS.unknown.title), text: tKey(ERRORS.unknown.text) }))
})

async function boot () {
  const root = document.documentElement
  const source = await createSource()
  setupI18n(source.config)
  root.lang = getLanguage()
  root.dir = textDirection()
  root.dataset.platform = source.platform
  const phone = source.platform !== 'desktop'

  if (desktopTheme) {
    await desktopTheme
    const update = () => { root.dataset.hdTheme = themeIsDark() ? 'dark' : 'light' }
    update()
    new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  } else {
    root.dataset.hdTheme = source.config.dark ? 'dark' : 'light'
  }
  const inset = source.config.safeArea
  if (inset) {
    for (const side of ['top', 'right', 'bottom', 'left']) root.style.setProperty(`--hd-inset-${side}`, `${inset[side]}px`)
  }

  const { classify, isJunk } = await import('/hyperdrive/viewer/lib/kinds.js')
  const { createThumbs } = await import('/hyperdrive/viewer/thumbs.js')
  const { openLightbox } = await import('/hyperdrive/viewer/lightbox.js')
  const { openPlayer } = await import('/hyperdrive/viewer/player.js')

  // The shell: a top bar over the view.
  const rtl = root.dir === 'rtl'
  const backButton = iconButton(rtl ? 'forward' : 'back', t('Up one folder'), () => goUp(), { className: 'hd-bar-back' })
  const title = h('h1', { class: 'hd-bar-title' })
  const subtitle = h('span', { class: 'hd-bar-sub' })
  const privateBadge = h('span', { class: 'hd-badge hd-badge--private', hidden: true, title: t('Only your own devices can open this drive') }, icon('lock'), t('Private'))
  const switcher = h('nav', { class: 'hd-switch', 'aria-label': t('View'), hidden: true })
  const actions = h('div', { class: 'hd-bar-actions' })
  const menuButton = iconButton('more', t('Menu'), () => openShellMenu(), { className: 'hd-bar-menu' })
  menuButton.setAttribute('aria-haspopup', 'menu')
  const bar = h('header', { class: 'hd-bar' },
    h('div', { class: 'hd-bar-inner' },
      backButton,
      h('div', { class: 'hd-bar-heading' }, h('div', { class: 'hd-bar-title-row' }, title, privateBadge), subtitle),
      switcher,
      actions,
      menuButton))
  const main = h('main', { class: 'hd-main', id: 'hd-main', tabindex: '-1' })
  document.body.append(h('div', { class: 'hd-app' }, bar, main))
  root.dataset.hdReady = '1'

  // The bar's height, for views that stick things under it.
  const measureBar = () => root.style.setProperty('--hd-bar-h', `${bar.offsetHeight}px`)
  new ResizeObserver(measureBar).observe(bar)
  measureBar()

  let store = null
  let storeFor = null
  let thumbs = null
  let current = null
  let generation = 0
  let listController = null
  let viewMenuItems = []
  let preloaded = false
  const listings = []
  const scrollPositions = new Map()
  try {
    window.history.scrollRestoration = 'manual'
  } catch {}

  // History, one change at a time. A Back the viewer makes itself (closing
  // an item) is waited for and not treated as the person's.
  let historyChain = Promise.resolve()
  let ownPops = 0
  const popWaiters = new Set()
  const historyStep = (step) => {
    historyChain = historyChain.then(step).catch(() => {})
    return historyChain
  }
  const back = () => new Promise((resolve) => {
    ownPops++
    const done = () => {
      clearTimeout(timer)
      popWaiters.delete(done)
      resolve()
    }
    const timer = setTimeout(() => {
      ownPops = Math.max(0, ownPops - 1)
      done()
    }, 700)
    popWaiters.add(done)
    window.history.back()
  })

  // Tells the phone's address bar where the page is now, after a change
  // the page did not make with setRoute (Back, Forward).
  function announce (route) {
    if (source.desktop || !route) return
    source.post({ type: 'route', url: peerskyHref(route), title: folderTitle(route.host, route.path, current?.listing?.name) })
  }

  function scrollKey (route) {
    return `${route.view}|${route.host}|${route.path}`
  }

  function rememberListing (route, result) {
    const at = listings.findIndex((cached) => cached.host === route.host && cached.path === route.path)
    if (at !== -1) listings.splice(at, 1)
    listings.unshift({ host: route.host, path: route.path, result, at: Date.now() })
    listings.length = Math.min(listings.length, 4)
  }

  // A folder inside one listed a moment ago needs no new listing.
  function cachedListing (route) {
    for (const cached of listings) {
      if (cached.host !== route.host || !route.path.startsWith(cached.path)) continue
      if (Date.now() - cached.at > LISTING_TTL) continue
      if (cached.path === route.path) return cached.result
      if (cached.result.truncated) continue
      const entries = cached.result.entries.filter((entry) => entry.path.startsWith(route.path))
      if (!entries.length) continue
      return { ...cached.result, entries }
    }
    return null
  }

  async function storeForDrive (host, isPrivate) {
    const persistent = !isPrivate && !source.config.incognito
    const wanted = `${host}|${persistent}`
    if (storeFor !== wanted) {
      if (thumbs) thumbs.stopAll()
      store = await openStore({ host, persistent, epoch: source.config.epoch })
      thumbs = createThumbs({ source, store, host })
      storeFor = wanted
    }
  }

  // Shell state a view may change, put back when it goes.
  const shell = {
    setSubtitle (text) {
      subtitle.textContent = text || ''
      subtitle.hidden = !text
    },
    setActions (...nodes) {
      replace(actions, ...nodes)
    },
    setMenuItems (items) {
      viewMenuItems = Array.isArray(items) ? items.filter(Boolean) : []
    },
    setDark (on) {
      if (on) root.dataset.hdForceDark = '1'
      else delete root.dataset.hdForceDark
    },
    setOverlayBar (on) {
      bar.classList.toggle('is-overlay', Boolean(on))
      root.classList.toggle('has-overlay-bar', Boolean(on))
    }
  }

  function resetShell () {
    delete root.dataset.hdView
    shell.setSubtitle('')
    shell.setActions()
    shell.setMenuItems([])
    shell.setDark(false)
    shell.setOverlayBar(false)
  }

  function updateBar (route, { classification, listing } = {}) {
    title.textContent = folderTitle(route.host, route.path, listing?.name)
    document.title = title.textContent
    backButton.hidden = route.path === '/'
    privateBadge.hidden = !(listing && listing.private)
    const counts = classification && classification.counts
    const views = VIEW_SWITCH.filter(({ view }) => view === 'files' || view === route.view ||
      (counts && (view === 'photos' ? counts.image > 0 : counts.video > 0)))
    switcher.hidden = !classification || views.length < 2
    replace(switcher, views.map(({ view, icon: iconName, label }) => h('a', {
      class: ['hd-switch-item', view === route.view && 'is-current'],
      href: routeHref({ view, host: route.host, path: route.path }),
      'aria-current': view === route.view ? 'page' : null,
      onClick: (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        if (view !== route.view) navigate({ view, path: route.path })
      }
    }, icon(iconName), h('span', null, tKey(label)))))
  }

  function openShellMenu () {
    const route = current ? current.route : parseRoute()
    if (!route) return
    openMenu(menuButton, [
      ...viewMenuItems,
      viewMenuItems.length ? { separator: true } : null,
      { label: t('Copy link'), icon: 'link', onSelect: () => copyWithToast(source, hyperHref(route.host, route.path)) },
      phone ? { label: t('Share'), icon: 'share', onSelect: () => share(route) } : null,
      { label: t('Open raw listing'), icon: 'raw', onSelect: () => openRaw(route) }
    ], { label: t('Menu') })
  }

  async function share (route) {
    const result = await source.share(route.host, route.path, folderTitle(route.host, route.path, current?.listing?.name))
    if (result === 'copied') toast(t('Link copied'))
  }

  // ?raw keeps the address from coming back here; noResolve lists a folder
  // that has an index file instead of serving the file.
  function openRaw (route) {
    source.openExternal(`${hyperHref(route.host, route.path)}?raw&noResolve`)
  }

  function showLoading (route) {
    resetShell()
    // Videos is always dark, so its loading screen is too, rather than a
    // light page that turns dark once the folder is listed.
    if (route.view === 'videos' && !route.auto) shell.setDark(true)
    const status = h('p', { class: 'hd-loading-text' }, t('Finding files...'))
    const slow = h('div', { class: 'hd-loading-slow', hidden: true },
      h('p', null, t('Still looking for someone who has this drive.')),
      button({ label: t('Try again'), icon: 'refresh', variant: 'quiet', onClick: () => go(route, { fresh: true }) }))
    replace(main, h('div', { class: 'hd-loading', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'hd-loading-status' }, h('span', { class: 'hd-spinner', 'aria-hidden': 'true' }), status),
      slow,
      skeleton({ count: 24 })))
    main.className = 'hd-main hd-main--loading'
    const timer = setTimeout(() => { slow.hidden = false }, SLOW_AFTER)
    return {
      progress (count) {
        if (count > 0) status.textContent = t('Finding files... {count}', { count: formatNumber(count) })
      },
      stop () {
        clearTimeout(timer)
      }
    }
  }

  function showError (code, route) {
    const known = ERRORS[code] || ERRORS.unknown
    resetShell()
    const actions = []
    if (route && code !== 'invalid') {
      if (code !== 'private') actions.push(button({ label: t('Try again'), icon: 'refresh', variant: 'primary', onClick: () => go(route, { fresh: true }) }))
      actions.push(button({ label: t('Open raw listing'), icon: 'raw', variant: 'quiet', onClick: () => openRaw(route) }))
    }
    main.className = 'hd-main hd-main--state'
    replace(main, stateView({ icon: known.icon, title: tKey(known.title), text: tKey(known.text), actions, tone: 'error' }))
  }

  function showEmpty (route) {
    resetShell()
    main.className = 'hd-main hd-main--state'
    replace(main, stateView({
      icon: 'folder',
      title: t('This folder is empty.'),
      actions: [button({ label: t('Open raw listing'), icon: 'raw', variant: 'quiet', onClick: () => openRaw(route) })]
    }))
  }

  // Overlays (the lightbox, the player, a view's dialogs) put #item=<path>
  // in the address, so Back closes them.
  const overlays = []
  let overlayCount = 0

  function overlay (path, { fromHash = false, onPop } = {}) {
    // Forward onto an entry this viewer pushed before: it is still ours, and
    // closing goes Back off it again.
    const state = window.history.state
    const earlier = fromHash && state && typeof state.hdOverlay === 'string' ? state.hdOverlay : null
    const id = earlier || `o${++overlayCount}${Date.now().toString(36)}`
    const record = { id, path, pushed: !fromHash || Boolean(earlier), onPop, closed: false }
    const route = current.route
    route.hash = { ...route.hash, item: path }
    const snapshot = { ...route, hash: { ...route.hash } }
    if (!earlier) historyStep(() => source.setRoute(snapshot, { replace: fromHash, state: { hdOverlay: id } }))
    overlays.push(record)
    return {
      update (nextPath) {
        if (record.closed) return
        record.path = nextPath
        route.hash = { ...route.hash, item: nextPath }
        const next = { ...route, hash: { ...route.hash } }
        historyStep(() => source.setRoute(next, { replace: true, state: { hdOverlay: id } }))
      },
      close () {
        if (record.closed) return
        record.closed = true
        overlays.splice(overlays.indexOf(record), 1)
        const { item, ...rest } = route.hash
        route.hash = rest
        historyStep(() => {
          const state = window.history.state
          if (record.pushed && state && state.hdOverlay === id) return back().then(() => announce({ ...route, hash: rest }))
          source.setRoute({ ...route, hash: rest }, { replace: true })
        })
      }
    }
  }

  // Closes overlays without touching history: on Back, or when leaving.
  function dropOverlays (keepPath) {
    for (const record of [...overlays].reverse()) {
      if (keepPath && record.path === keepPath) continue
      record.closed = true
      overlays.splice(overlays.indexOf(record), 1)
      if (record.onPop) {
        try {
          record.onPop()
        } catch {}
      }
    }
  }

  function setHash (hash, { push = false } = {}) {
    if (!current) return
    const route = current.route
    route.hash = { ...(hash || {}) }
    const next = { ...route, hash: { ...route.hash } }
    historyStep(() => source.setRoute(next, { replace: !push }))
  }

  function navigate (to = {}, { replace: replaceEntry = false } = {}) {
    const from = current ? current.route : parseRoute()
    if (!from) return
    const view = to.view || from.view
    const next = {
      view: view === 'auto' ? 'files' : view,
      host: from.host,
      path: folderPath(to.path || from.path),
      hash: to.hash || {},
      auto: view === 'auto'
    }
    dropOverlays()
    historyStep(() => source.setRoute(next, { replace: replaceEntry }))
    go(next)
  }

  function goUp () {
    if (!current || current.route.path === '/') return
    navigate({ path: parentPath(current.route.path), view: current.route.view === 'files' ? 'files' : 'auto' })
  }

  function unmountView () {
    if (!current) return
    scrollPositions.set(scrollKey(current.route), window.scrollY)
    if (current.handle && typeof current.handle.unmount === 'function') {
      try {
        current.handle.unmount()
      } catch (error) {
        console.error(error)
      }
    }
    if (current.controller) current.controller.abort()
    if (thumbs) thumbs.stopAll()
    current.handle = null
    closeMenu()
  }

  async function go (requested, { fresh = false } = {}) {
    const gen = ++generation
    dropOverlays()
    unmountView()
    let route = { ...requested, hash: { ...(requested.hash || {}) } }
    updateBar(route)
    if (listController) listController.abort()

    let listing = fresh ? null : cachedListing(route)
    if (!listing) {
      const loading = showLoading(route)
      const controller = new AbortController()
      listController = controller
      try {
        listing = await source.list(route.host, route.path, { signal: controller.signal, onProgress: loading.progress })
      } catch (error) {
        if (gen !== generation || error.name === 'AbortError') return
        current = { route, listing: null }
        showError(error.code || 'unknown', route)
        return
      } finally {
        loading.stop()
      }
      if (gen !== generation) return
      rememberListing(route, listing)
    }

    await storeForDrive(route.host, listing.private)
    if (gen !== generation) return
    const classification = classify(listing.entries, route.path)
    if (route.auto) {
      route = { ...route, view: classification.view, auto: false }
      const settled = { ...route, hash: { ...route.hash } }
      historyStep(() => source.setRoute(settled, { replace: true }))
    }
    current = { route, listing, classification, handle: null, controller: null }
    updateBar(route, { classification, listing })

    const files = listing.entries.filter((entry) => !isJunk(entry.path.slice(route.path.length - 1)))
    if (!files.length) {
      showEmpty(route)
      return
    }

    // The view's code first, so the old view stays on screen until the new
    // one can take its place.
    let module
    try {
      module = await VIEW_MODULES[route.view]()
    } catch (error) {
      console.error(error)
      if (gen === generation) showError('unknown', route)
      return
    }
    if (gen !== generation) return

    const controller = new AbortController()
    resetShell()
    root.dataset.hdView = route.view
    main.className = `hd-main hd-main--${route.view}`
    main.replaceChildren()
    const ctx = {
      root: main,
      source,
      store,
      thumbs,
      route,
      listing,
      classification,
      t,
      tp,
      i18n,
      ui,
      signal: controller.signal,
      savedScroll: scrollPositions.get(scrollKey(route)) || 0,
      navigate,
      setHash,
      overlay,
      openLightbox (items, index = 0, options = {}) {
        const first = items && items[index]
        if (!first) return null
        let box = null
        const handle = overlay(first.path, { fromHash: options.fromHash, onPop: () => box && box.close() })
        box = openLightbox(ctx, items, index, {
          ...options,
          onChange (at, item) {
            handle.update(item.path)
            if (options.onChange) options.onChange(at, item)
          },
          onClose () {
            handle.close()
            if (options.onClose) options.onClose()
          }
        })
        return box
      },
      openPlayer (entry, options = {}) {
        let player = null
        const handle = overlay(entry.path, { fromHash: options.fromHash, onPop: () => player && player.close() })
        player = openPlayer(ctx, entry, {
          ...options,
          onChange (item) {
            handle.update(item.path)
            if (options.onChange) options.onChange(item)
          },
          onClose () {
            handle.close()
            if (options.onClose) options.onClose()
          }
        })
        return player
      },
      shell
    }
    current.controller = controller
    current.ctx = ctx

    let handle
    try {
      handle = await module.mount(ctx)
    } catch (error) {
      console.error(error)
      if (gen === generation) showError('unknown', route)
      return
    }
    if (gen !== generation) {
      if (handle && typeof handle.unmount === 'function') handle.unmount()
      return
    }
    current.handle = typeof handle === 'function' ? { unmount: handle } : (handle || {})
    const saved = ctx.savedScroll
    requestAnimationFrame(() => window.scrollTo(0, saved))
    if (!requested.auto) historyStep(() => source.setRoute({ ...route, hash: { ...route.hash } }, { replace: true, state: window.history.state }))
    // The other views' code, so switching is instant.
    if (!preloaded) {
      preloaded = true
      setTimeout(() => {
        for (const load of Object.values(VIEW_MODULES)) load().catch(() => {})
      }, 1000)
    }
  }

  window.addEventListener('popstate', () => {
    if (ownPops > 0) {
      ownPops--
      for (const done of [...popWaiters]) done()
      return
    }
    const next = parseRoute()
    if (!next) {
      dropOverlays()
      unmountView()
      showError('invalid')
      return
    }
    const now = current && current.route
    if (now && now.host === next.host && now.path === next.path && now.view === next.view) {
      const keep = typeof next.hash.item === 'string' ? next.hash.item : null
      const rest = (hash) => JSON.stringify(Object.entries(hash).filter(([key]) => key !== 'item'))
      const sameRest = rest(now.hash) === rest(next.hash)
      now.hash = next.hash
      announce(now)
      dropOverlays(keep)
      // The item asked for is the one already open: nothing to do.
      if (keep && sameRest && overlays.some((record) => record.path === keep)) return
      if (current.handle && typeof current.handle.onHash === 'function') {
        try {
          current.handle.onHash(next.hash)
        } catch (error) {
          console.error(error)
        }
      }
      return
    }
    announce(next)
    go(next)
  })

  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.key === 'ArrowUp' && !event.defaultPrevented) {
      event.preventDefault()
      goUp()
    }
  })

  const first = parseRoute()
  if (!first) {
    updateBar({ view: 'files', host: '', path: '/' })
    backButton.hidden = true
    title.textContent = t('Hyperdrive')
    showError('invalid')
    return
  }
  go(first)
}
