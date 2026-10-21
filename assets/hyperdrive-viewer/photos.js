/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { h, icon, button, stateView, lazyChunks, debounce, replace, kindBadge } from '/hyperdrive/viewer/ui.js'
import { t, tp, formatNumber, formatDate, formatDuration, formatBytes, formatList, regionName, getLanguage } from '/hyperdrive/viewer/i18n.js'
import { kindOf, isJunk, isImageKind, livePhotoPairs, sidecarsOf, fileName, folderOf, extensionOf, folderIndex, takeoutIndex, takeoutTarget, naturalCompare } from '/hyperdrive/viewer/lib/kinds.js'
import { dateFromName, isUtcName } from '/hyperdrive/viewer/lib/names.js'
import { parseTakeoutJson, wallClockOf } from '/hyperdrive/viewer/lib/sidecars.js'
import { createPlaceIndex, nearestPlace, placeKey } from '/hyperdrive/viewer/lib/places.js'
import { displayName, routeHref, folderPath, parentPath } from '/hyperdrive/viewer/route.js'

// Photos: the folder as a camera roll, made only from its files. A timeline
// by month and day, newest first; albums from its folders; places from where
// photos were taken, looked up on this device.
//
// It shows at once with the dates that cost nothing (the file's name, the
// drive's own time), reads what each photo and clip says about itself in the
// background, and settles the timeline in batches while the photo at the top
// of the screen stays where it is. What it read is kept for next time, in
// memory only for a private drive.
//
// Only rows near the screen exist. Each month is a box of known height, cut
// into chunks that are filled as they come near and emptied as they leave.

const DAY = 86400000
const STYLES = '/hyperdrive/viewer/photos.css'
const CACHE_VERSION = 1
const SOURCES = ['none', 'exif', 'video', 'takeout', 'name', 'mtime']
const MAX_TAKEOUT_JSON = 256 * 1024
const READERS = 6
const FLUSH_AFTER = 700
const SAVE_AFTER = 5000
const STATUS_AFTER = 600
const PLACE_KM = 60
const COUNTRY_KM = 400
const ELSEWHERE = 'elsewhere'
const FILL_MARGIN = 600
const NOTHING = new Set()
const PHOTOS = Object.freeze({ tab: 'photos', album: null, place: null })
// Formats every engine draws, for album and place covers.
const DRAWN_EVERYWHERE = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'bmp'])

const px = (value) => `${Math.round(value * 100) / 100}px`

let styles = null

// photos.css, added once and waited for, so the view never shows unstyled.
function loadStyles () {
  if (!styles) {
    styles = new Promise((resolve) => {
      const link = h('link', { rel: 'stylesheet', href: STYLES })
      link.addEventListener('load', () => resolve(), { once: true })
      link.addEventListener('error', () => resolve(), { once: true })
      setTimeout(resolve, 2500)
      document.head.append(link)
    })
  }
  return styles
}

let placeTable = null

// The towns table (data/places.js), loaded the first time a photo has a
// location. Null when it cannot be loaded.
function loadPlaceTable () {
  if (!placeTable) {
    placeTable = import('/hyperdrive/viewer/data/places.js')
      .then((module) => createPlaceIndex(module.default))
      .catch(() => null)
  }
  return placeTable
}

const formats = new Map()

// A date format in the viewer's language, for wall-clock times kept as UTC.
function dateFormat (options) {
  const key = JSON.stringify(options)
  let format = formats.get(key)
  if (!format) {
    try {
      format = new Intl.DateTimeFormat(getLanguage(), { ...options, timeZone: 'UTC' })
    } catch {
      format = new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' })
    }
    formats.set(key, format)
  }
  return format
}

// Sorts names the way people count: 'IMG 2' before 'IMG 10'.
function naturalKey (name) {
  return name.toLowerCase().replace(/\d+/g, (digits) => (digits.length >= 16 ? digits : digits.padStart(16, '0')))
}

// Newest first; photos of one moment by name; no date last, by name.
function compareItems (a, b) {
  if (a.ms !== b.ms) {
    if (a.ms === null) return 1
    if (b.ms === null) return -1
    return b.ms - a.ms
  }
  if (a.key === b.key) return 0
  const order = a.key < b.key ? -1 : 1
  return a.ms === null ? order : -order
}

function dayKeyOf (item) {
  return item.ms === null ? 'none' : Math.floor(item.ms / DAY)
}

function locationOf (gps) {
  if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lon)) return null
  if (Math.abs(gps.lat) > 90 || Math.abs(gps.lon) > 180 || (gps.lat === 0 && gps.lon === 0)) return null
  return { lat: gps.lat, lon: gps.lon }
}

function countText (photos, videos) {
  const parts = []
  if (photos) parts.push(tp({ one: '{count} photo', other: '{count} photos' }, photos))
  if (videos) parts.push(tp({ one: '{count} video', other: '{count} videos' }, videos))
  return formatList(parts)
}

function countOf (list) {
  let videos = 0
  for (const item of list) if (item.kind === 'video') videos++
  return countText(list.length - videos, videos)
}

// When a list of items (newest first) was taken, as one range of days.
function rangeText (list) {
  let newest = null
  let oldest = null
  for (const item of list) {
    if (item.ms === null) continue
    if (newest === null) newest = item.ms
    oldest = item.ms
  }
  if (newest === null) return ''
  const format = dateFormat({ year: 'numeric', month: 'short', day: 'numeric' })
  const first = new Date(oldest)
  const last = new Date(newest)
  if (typeof format.formatRange === 'function') {
    try {
      return format.formatRange(first, last)
    } catch {}
  }
  const from = format.format(first)
  const to = format.format(last)
  return from === to ? from : `${from} – ${to}`
}

function placeName (place) {
  if (!place) return ''
  const country = place.country ? regionName(place.country) : ''
  return country ? t('{place}, {country}', { place: place.name, country }) : place.name
}

// The Takeout JSON of each photo and clip that has one, found once per
// folder (kinds.js' takeoutTarget), not once per photo.
function takeoutPaths (items, entries, jsonFolders) {
  const found = new Map()
  if (!jsonFolders.size) return found
  const files = folderIndex(entries).files
  const byFolder = new Map()
  for (const item of items) {
    if (!jsonFolders.has(item.folder)) continue
    const list = byFolder.get(item.folder)
    if (list) list.push(item)
    else byFolder.set(item.folder, [item])
  }
  for (const [folder, media] of byFolder) {
    const names = []
    const jsons = []
    for (const entry of files.get(folder) || []) {
      const kind = kindOf(entry.path, entry.size)
      if (isImageKind(kind) || kind === 'video') names.push(fileName(entry.path).toLowerCase())
      else if (extensionOf(entry.path) === 'json') jsons.push(entry.path)
    }
    const index = takeoutIndex(names)
    const best = new Map()
    for (const path of jsons) {
      const json = fileName(path).toLowerCase()
      const target = takeoutTarget(json, index)
      if (!target) continue
      const rank = json === target + '.json' ? 0 : json === target + '.supplemental-metadata.json' ? 1 : 2 + json.length
      const held = best.get(target)
      if (!held || rank < held.rank) best.set(target, { rank, path })
    }
    for (const item of media) {
      const lower = item.name.toLowerCase()
      const hit = best.get(lower) || best.get(lower.replace(/-edited(\.[^.]+)$/, '$1'))
      if (hit) found.set(item.path, hit.path)
    }
  }
  return found
}

// Every photo and clip under the folder, without junk, sidecars and the
// moving parts of Live Photos.
function buildLibrary (entries, base) {
  const live = livePhotoPairs(entries, base)
  const motions = new Set(live.values())
  const sidecars = sidecarsOf(entries, base)
  const byPath = new Map()
  const jsonFolders = new Set()
  for (const entry of entries) {
    byPath.set(entry.path, entry)
    if (extensionOf(entry.path) === 'json') jsonFolders.add(folderOf(entry.path))
  }
  const items = []
  for (const entry of entries) {
    if (!entry.path.startsWith(base) || isJunk(entry.path.slice(base.length - 1))) continue
    if (sidecars.has(entry.path) || motions.has(entry.path)) continue
    const kind = kindOf(entry.path, entry.size)
    if (!isImageKind(kind) && kind !== 'video') continue
    const name = fileName(entry.path)
    const motion = live.get(entry.path)
    items.push({
      entry,
      path: entry.path,
      name,
      folder: folderOf(entry.path),
      kind: kind === 'video' ? 'video' : 'image',
      motion: motion ? byPath.get(motion) || null : null,
      key: naturalKey(name) + '\u0000' + entry.path,
      ms: null,
      source: 'none',
      done: false,
      cacheable: false,
      gps: null,
      place: undefined,
      country: null,
      duration: null
    })
  }
  return { items, byPath, takeout: takeoutPaths(items, entries, jsonFolders) }
}

// The dates that cost nothing, worked out the way thumbs.takenAt() does: the
// time in the file's name (a Pixel's is UTC, so it is turned into this
// device's time), else the drive's own time for the file.
function fastDate (item) {
  const named = dateFromName(item.name)
  if (Number.isFinite(named)) return { ms: isUtcName(item.name) ? wallClockOf(named, null) : named, source: 'name' }
  if (Number.isFinite(item.entry.mtime)) return { ms: wallClockOf(item.entry.mtime, null), source: 'mtime' }
  return { ms: null, source: 'none' }
}

// A phone-sized window: the grid runs edge to edge (photos.css says the same).
const COMPACT = '(max-width: 599px)'

// Columns and sizes for a width: 3 across on a phone, up to about 8 wide.
function geometryFor (width) {
  const compact = typeof matchMedia === 'function' ? matchMedia(COMPACT).matches : width < 600
  const cols = compact ? 3 : Math.max(4, Math.min(width > 1600 ? 10 : 8, Math.round(width / 150)))
  const gap = compact ? 2 : 4
  const size = Math.max(40, (width - gap * (cols - 1)) / cols)
  return {
    width,
    compact,
    cols,
    gap,
    size,
    labelH: compact ? 30 : 32,
    headH: compact ? 46 : 52,
    end: compact ? 12 : 18,
    rowsPerChunk: Math.max(3, Math.ceil(720 / (size + gap)))
  }
}

// Rows of one month. A day that fits on one row may share it with the days
// next to it, each under its own date; a longer day takes whole rows.
function packRows (days, cols) {
  const rows = []
  let open = null
  for (const day of days) {
    const count = day.items.length
    if (open && open.used + count <= cols) {
      open.segments.push({ day, start: 0, count })
      open.used += count
      continue
    }
    open = null
    for (let start = 0; start < count; start += cols) {
      const take = Math.min(cols, count - start)
      const row = { label: day.label !== null && start === 0, segments: [{ day, start, count: take }], used: take, y: 0, height: 0, chunk: null }
      rows.push(row)
      if (count <= cols) open = row
    }
  }
  return rows
}

function barHeight () {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hd-bar-h'))
  return Number.isFinite(value) ? value : 60
}

/** Mounts the Photos view; see app.js for what ctx holds. */
export async function mount (ctx) {
  const { source, store, thumbs, route, listing, classification, shell } = ctx
  const host = route.host
  const base = route.path
  const entries = listing.entries
  const signal = ctx.signal
  const rtl = document.documentElement.dir === 'rtl'

  await loadStyles()
  const view = h('div', { class: 'hd-photos' })
  ctx.root.append(view)

  const lib = buildLibrary(entries, base)
  const items = lib.items
  if (!items.length) {
    view.append(stateView({
      icon: 'image',
      title: t('No photos or videos here'),
      text: t('This folder has files, but no photos or videos.'),
      actions: [button({ label: t('Show in Files'), icon: 'folder', variant: 'primary', onClick: () => ctx.navigate({ view: 'files' }) })]
    }))
    return {}
  }

  shell.setSubtitle(countOf(items))
  for (const item of items) Object.assign(item, fastDate(item))
  await loadCache()
  if (signal.aborted) return {}

  let destroyed = false
  let order = items.slice().sort(compareItems)
  let state = PHOTOS
  let scope = null
  let box = null
  let lastShown = null
  let pushedScope = false
  let readCount = 0
  let locatedCount = 0
  for (const item of items) {
    if (item.done) readCount++
    if (item.gps) locatedCount++
  }
  let reading = readCount < items.length
  let statusReady = false
  let statusTimer = null
  let flushTimer = null
  let saveTimer = null
  let dirty = false
  let pendingDates = new Set()
  let pendingPlaces = locatedCount > 0
  let relabel = false
  const scrolls = new Map()
  const tileItems = new WeakMap()
  const hasAlbums = items.some((item) => item.folder !== base)

  // ---------- What was read before ----------

  // Dates, places and lengths kept for this folder, or for a folder above
  // it, by the version of each file (its size and time).
  async function loadCache () {
    const keys = []
    for (let path = base; ; path = parentPath(path)) {
      keys.push(store.key(path, 'photos', CACHE_VERSION))
      if (path === '/') break
    }
    let values = []
    try {
      values = await Promise.race([
        Promise.all(keys.map((key) => store.getMeta(key).catch(() => null))),
        new Promise((resolve) => setTimeout(() => resolve([]), 1500))
      ])
    } catch {}
    for (const value of values) {
      const rows = value && value.v === CACHE_VERSION && value.items && typeof value.items === 'object' ? value.items : null
      if (!rows) continue
      for (const item of items) {
        if (item.done || !Object.prototype.hasOwnProperty.call(rows, item.path)) continue
        const row = rows[item.path]
        if (Array.isArray(row) && row[0] === item.entry.size && row[1] === (item.entry.mtime ?? null)) applyRow(item, row)
      }
    }
  }

  // A date as thumbs.takenAt() worked it out, which it keeps the same way.
  function applyRow (item, row) {
    const kept = SOURCES[row[3]]
    if (!kept || (kept !== 'none' && !Number.isFinite(row[2]))) return
    item.ms = kept === 'none' ? null : row[2]
    item.source = kept
    item.gps = locationOf({ lat: row[4], lon: row[5] })
    item.duration = Number.isFinite(row[6]) ? row[6] : null
    item.done = true
    item.cacheable = true
  }

  function scheduleSave () {
    if (!saveTimer && !destroyed) saveTimer = setTimeout(save, SAVE_AFTER)
  }

  function save () {
    clearTimeout(saveTimer)
    saveTimer = null
    if (!dirty) return
    dirty = false
    const rows = {}
    for (const item of items) {
      if (!item.done || !item.cacheable) continue
      rows[item.path] = [item.entry.size, item.entry.mtime ?? null, item.ms, SOURCES.indexOf(item.source), item.gps ? item.gps.lat : null, item.gps ? item.gps.lon : null, item.duration]
    }
    store.putMeta(store.key(base, 'photos', CACHE_VERSION), { v: CACHE_VERSION, items: rows }).catch(() => {})
  }

  // ---------- Reading in the background ----------

  // Each photo's and clip's own date, place and length, newest first, a few
  // at a time and behind the thumbnails on screen.
  function startReading () {
    const queue = order.filter((item) => !item.done)
    if (!queue.length) {
      finishReading()
      return
    }
    let next = 0
    let active = 0
    const pump = () => {
      if (destroyed) return
      while (active < READERS && next < queue.length) {
        const item = queue[next++]
        if (item.done) continue
        active++
        readItem(item).then(() => {
          active--
          pump()
        })
      }
      if (!active && next >= queue.length) finishReading()
    }
    pump()
  }

  async function readItem (item) {
    // The listing goes along only when a Takeout JSON is there to read: it
    // is searched folder by folder.
    const jsonPath = lib.takeout.get(item.path)
    let when = null
    let complete = true
    try {
      when = await thumbs.takenAt(item.entry, { entries: jsonPath ? entries : undefined, signal, priority: 'low' })
    } catch {
      if (signal.aborted) return
      complete = false
    }
    let meta = null
    try {
      meta = item.kind === 'video'
        ? await thumbs.videoMeta(item.entry, { signal, priority: 'low' })
        : await thumbs.imageMeta(item.entry, { signal, priority: 'low' })
    } catch {
      if (signal.aborted) return
      complete = false
    }
    let gps = locationOf(meta && meta.gps)
    if (!gps && jsonPath) {
      try {
        const takeout = parseTakeoutJson(await source.text(host, jsonPath, { maxBytes: MAX_TAKEOUT_JSON, signal }))
        gps = locationOf(takeout && takeout.gps)
      } catch {
        if (signal.aborted) return
        complete = false
      }
    }
    if (signal.aborted || destroyed || item.done) return
    const before = item.ms
    if (when && when.source) {
      item.ms = Number.isFinite(when.ms) ? when.ms : null
      item.source = when.source
    }
    item.gps = gps
    if (meta && Number.isFinite(meta.duration)) item.duration = meta.duration
    item.done = true
    item.cacheable = complete
    readCount++
    dirty = true
    if (item.ms !== before) pendingDates.add(item)
    if (gps) {
      locatedCount++
      pendingPlaces = true
    }
    if (item.kind === 'video' && scope && scope.timeline) scope.timeline.refreshItem(item)
    scheduleFlush()
  }

  function finishReading () {
    if (destroyed) return
    reading = false
    clearTimeout(flushTimer)
    flush()
    save()
  }

  function scheduleFlush (wait = FLUSH_AFTER) {
    if (!flushTimer && !destroyed) flushTimer = setTimeout(flush, wait)
  }

  // A batch of what was read goes on screen at once.
  function flush () {
    clearTimeout(flushTimer)
    flushTimer = null
    if (destroyed) return
    if (pendingPlaces) {
      pendingPlaces = false
      resolvePlaces().then((changed) => {
        if (!changed || destroyed) return
        relabel = true
        scheduleFlush(0)
      })
    }
    const changed = pendingDates
    pendingDates = new Set()
    const labels = relabel
    relabel = false
    if (changed.size) order = items.slice().sort(compareItems)
    if (scope && scope.refresh) scope.refresh(changed, labels)
    renderTabs()
    updateStatus()
    if (dirty) scheduleSave()
  }

  // The nearest town to each located photo, within 60 km; for the others,
  // the country of a town further away, when there is one.
  async function resolvePlaces () {
    const pending = items.filter((item) => item.gps && item.place === undefined)
    if (!pending.length) return false
    const table = await loadPlaceTable()
    if (destroyed) return false
    for (const item of pending) {
      if (item.place !== undefined) continue
      const { lat, lon } = item.gps
      item.place = table ? nearestPlace(table, lat, lon, { maxKm: PLACE_KM }) : null
      if (!item.place && table) {
        const near = nearestPlace(table, lat, lon, { maxKm: COUNTRY_KM })
        item.country = near ? near.country : null
      }
    }
    return true
  }

  function placesPending () {
    return reading || items.some((item) => item.gps && item.place === undefined)
  }

  // ---------- Status ----------

  // How far the reading is, floating at the bottom, so it is seen wherever
  // the page is scrolled and never moves the grid; and a note in the row
  // under the bar when nothing had a date.
  const progressEl = h('div', { class: 'hd-ph-progress', hidden: true })
  const noteEl = h('p', { class: 'hd-ph-note', hidden: true })
  ctx.root.append(progressEl)

  function updateStatus () {
    let progress = ''
    if (reading && !statusReady && !statusTimer) {
      statusTimer = setTimeout(() => {
        statusTimer = null
        statusReady = true
        updateStatus()
      }, STATUS_AFTER)
    }
    if (reading && statusReady) {
      const percent = formatNumber(Math.min(0.99, readCount / items.length), { style: 'percent', maximumFractionDigits: 0 })
      progress = state.tab === 'places' && !state.place ? t('Finding places... {percent}', { percent }) : t('Reading dates... {percent}', { percent })
    }
    progressEl.hidden = !progress
    replace(progressEl, progress ? [h('span', { class: 'hd-spinner', 'aria-hidden': 'true' }), h('span', null, progress)] : null)
    const undated = !reading && state.tab === 'photos' && !items.some((item) => item.ms !== null)
    noteEl.hidden = !undated
    noteEl.textContent = undated ? t('No dates found, so these are in name order.') : ''
  }

  // ---------- Where we are: tabs, albums and places in the address ----------

  function stateFrom (hash) {
    if (typeof hash.album === 'string' && hash.album) return { tab: 'albums', album: folderPath(hash.album), place: null }
    if (typeof hash.place === 'string' && hash.place) return { tab: 'places', album: null, place: hash.place }
    if (hash.albums) return { tab: 'albums', album: null, place: null }
    if (hash.places) return { tab: 'places', album: null, place: null }
    return PHOTOS
  }

  function hashOf (next) {
    if (next.album) return { album: next.album }
    if (next.place) return { place: next.place }
    if (next.tab === 'albums') return { albums: true }
    if (next.tab === 'places') return { places: true }
    return {}
  }

  const sameState = (a, b) => a.tab === b.tab && a.album === b.album && a.place === b.place
  const stateKey = (next) => (next.album ? `album:${next.album}` : next.place ? `place:${next.place}` : next.tab)

  // What can be shown: an album that is there, a tab that has something.
  function settle (wanted) {
    if (wanted.album) return albumList().some((album) => album.path === wanted.album) ? wanted : { tab: hasAlbums ? 'albums' : 'photos', album: null, place: null }
    if (wanted.tab === 'albums' && !hasAlbums) return PHOTOS
    if (wanted.tab === 'places' && !locatedCount && !reading) return PHOTOS
    return wanted
  }

  // A tab, album or place picked here. Opening an album or place adds a
  // step to history; a tab replaces this one.
  function go (wanted, { push = false } = {}) {
    if (scope && sameState(wanted, state)) return
    ctx.setHash(hashOf(wanted), { push })
    pushedScope = push
    show(wanted)
  }

  // Back from an album or place: the step back in history when this view
  // made it, else the tab in place of this address.
  function back (target) {
    if (pushedScope) {
      pushedScope = false
      window.history.back()
      return
    }
    go(target)
  }

  function show (wanted, { initial = false } = {}) {
    const next = settle(wanted)
    if (scope && sameState(next, state)) return
    if (scope) {
      scrolls.set(stateKey(state), window.scrollY)
      scope.destroy()
      scope = null
    }
    state = next
    if (!sameState(next, wanted)) ctx.setHash(hashOf(next))
    scope = next.album
      ? albumScope(next.album)
      : next.place
        ? placeScope(next.place)
        : next.tab === 'albums'
          ? albumsScope()
          : next.tab === 'places' ? placesScope() : libraryScope()
    if (!initial) {
      window.scrollTo(0, scrolls.get(stateKey(next)) || 0)
      if (scope.timeline) scope.timeline.fillVisible()
    }
    updateStatus()
  }

  // ---------- Tabs ----------

  const tabsEl = h('div', { class: 'hd-ph-tabs', role: 'tablist', 'aria-label': t('Photo library') })

  function renderTabs () {
    // Not "Photos", which the view switcher above already says.
    const list = [{ id: 'photos', label: t('Library') }]
    if (hasAlbums) list.push({ id: 'albums', label: t('Albums') })
    if (locatedCount || (state.tab === 'places' && reading)) list.push({ id: 'places', label: t('Places') })
    tabsEl.hidden = list.length < 2
    const signature = list.map((tab) => tab.id).join() + '|' + state.tab
    if (tabsEl.dataset.tabs === signature) return
    tabsEl.dataset.tabs = signature
    replace(tabsEl, list.map(({ id, label }, index) => h('button', {
      type: 'button',
      class: 'hd-ph-tab',
      role: 'tab',
      'aria-selected': String(state.tab === id),
      tabindex: state.tab === id ? '0' : '-1',
      onClick: () => go({ tab: id, album: null, place: null }),
      onKeydown: (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        event.preventDefault()
        const other = list[(index + (rtl ? -step : step) + list.length) % list.length]
        go({ tab: other.id, album: null, place: null })
        const button = tabsEl.querySelector('[aria-selected="true"]')
        if (button) button.focus()
      }
    }, label)))
  }

  function head () {
    renderTabs()
    return h('div', { class: 'hd-ph-head' }, tabsEl, noteEl)
  }

  function scopeHead ({ back: backText, backLabel, onBack, title, sub, actions }) {
    return h('div', { class: 'hd-ph-head hd-ph-head--scope' },
      h('button', { type: 'button', class: 'hd-ph-back', 'aria-label': backLabel, onClick: onBack }, icon(rtl ? 'forward' : 'back'), h('span', null, backText)),
      h('div', { class: 'hd-ph-scope-row' },
        h('div', { class: 'hd-ph-scope-titles' }, title, sub),
        actions || null))
  }

  // ---------- Pictures ----------

  // A photo's own picture; for a Live Photo this engine cannot draw (HEIC
  // on Chromium), a frame of its moving part; for a clip, a frame.
  function attachPicture (img, item, done) {
    if (item.kind === 'video') {
      thumbs.attach(img, item.entry, { kind: 'video', entries, prefer: 'frame', onResult: done })
      return
    }
    thumbs.attach(img, item.entry, {
      kind: 'photo',
      entries,
      onResult: (url) => {
        if (url || !item.motion) done(url)
        else thumbs.attach(img, item.motion, { kind: 'video', entries, prefer: 'frame', onResult: done })
      }
    })
  }

  function showPicture (img, holder, url) {
    if (!url) {
      holder.classList.add('is-missing')
      return
    }
    holder.classList.remove('is-missing')
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true })
    img.addEventListener('error', () => {
      img.removeAttribute('src')
      holder.classList.add('is-missing')
    }, { once: true })
    img.setAttribute('src', url)
  }

  function makeTile (item) {
    const img = h('img', { class: 'hd-ph-img', alt: '', draggable: 'false', decoding: 'async' })
    const el = h('button', {
      type: 'button',
      class: ['hd-ph-tile', item.kind === 'video' && 'is-clip', item.motion && 'is-live'],
      'aria-label': displayName(item.name)
    }, img, h('span', { class: 'hd-ph-format', 'aria-hidden': 'true' }, icon(item.kind === 'video' ? 'video' : 'image'), h('span', null, thumbs.badge(item.entry))))
    const tile = { el, img, item, time: null, cancel: null }
    if (item.motion) el.append(h('span', { class: 'hd-ph-live', 'aria-hidden': 'true' }, icon('live'), h('span', null, t('LIVE'))))
    if (item.kind === 'video') {
      tile.time = h('span', { class: 'hd-ph-time' }, Number.isFinite(item.duration) ? formatDuration(item.duration) : '')
      el.append(h('span', { class: 'hd-ph-clip', 'aria-hidden': 'true' }, icon('play'), tile.time))
      if (!Number.isFinite(item.duration)) {
        const controller = new AbortController()
        tile.cancel = () => controller.abort()
        thumbs.videoMeta(item.entry, { signal: controller.signal, priority: 'low' }).then((meta) => {
          if (!meta || !Number.isFinite(meta.duration)) return
          item.duration = meta.duration
          tile.time.textContent = formatDuration(meta.duration)
        }, () => {})
      }
    }
    tileItems.set(el, item)
    attachPicture(img, item, (url) => showPicture(img, el, url))
    return tile
  }

  function releaseTile (tile) {
    thumbs.detach(tile.img)
    if (tile.cancel) tile.cancel()
  }

  // ---------- The timeline ----------

  function createTimeline ({ onOpen }) {
    const element = h('div', { class: 'hd-ph-timeline' })
    const chunkOf = new WeakMap()
    let alive = true
    let geo = null
    let list = []
    let dayKeys = []
    let sections = []
    let flatRows = []
    let positions = new Map()
    let tiles = new Map()

    const near = new IntersectionObserver((records) => {
      for (const record of records) {
        const chunk = chunkOf.get(record.target)
        if (chunk && record.isIntersecting) fill(chunk)
      }
    }, { rootMargin: '1200px 0px' })
    const far = new IntersectionObserver((records) => {
      for (const record of records) {
        const chunk = chunkOf.get(record.target)
        if (chunk && !record.isIntersecting) empty(chunk)
      }
    }, { rootMargin: '3600px 0px' })

    function contentWidth () {
      const width = element.clientWidth
      if (!width) return Math.max(280, window.innerWidth)
      const style = getComputedStyle(element)
      return Math.max(200, width - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0))
    }

    // Months and days, in the order of the list.
    function group () {
      const months = []
      let month = null
      let day = null
      dayKeys = new Array(list.length)
      list.forEach((item, index) => {
        const dayKey = dayKeyOf(item)
        dayKeys[index] = dayKey
        const date = item.ms === null ? null : new Date(item.ms)
        const monthKey = date ? date.getUTCFullYear() * 12 + date.getUTCMonth() : 'none'
        if (!month || month.key !== monthKey) {
          month = { key: monthKey, ms: item.ms, days: [], photos: 0, videos: 0 }
          months.push(month)
          day = null
        }
        if (!day || day.key !== dayKey) {
          day = { key: dayKey, ms: item.ms, items: [], label: null, title: '', place: '' }
          month.days.push(day)
        }
        day.items.push(item)
        if (item.kind === 'video') month.videos++
        else month.photos++
      })
      return months
    }

    function dayLabels (day) {
      if (day.key === 'none') return
      const today = Math.floor(wallClockOf(Date.now(), null) / DAY)
      day.label = day.key === today
        ? t('Today')
        : day.key === today - 1 ? t('Yesterday') : dateFormat({ weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(day.ms))
      const counts = new Map()
      for (const item of day.items) {
        if (item.place) counts.set(item.place.name, (counts.get(item.place.name) || 0) + 1)
      }
      day.place = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)[0] || ''
      const full = formatDate(day.ms, { utc: true, style: 'dayYear' })
      day.title = day.place ? `${full} · ${day.place}` : full
    }

    function layout () {
      geo = geometryFor(contentWidth())
      sections = []
      flatRows = []
      positions = new Map()
      const months = group()
      const lone = months.length === 1 && months[0].key === 'none'
      let top = 0
      let index = 0
      for (const month of months) {
        for (const day of month.days) dayLabels(day)
        const headH = lone ? 0 : geo.headH
        const rows = packRows(month.days, geo.cols)
        let y = 0
        for (const row of rows) {
          row.y = y
          row.height = (row.label ? geo.labelH : 0) + geo.size
          y += row.height + geo.gap
        }
        const bodyH = rows.length ? y - geo.gap : 0
        const section = {
          key: month.key,
          label: month.key === 'none' ? t('No date') : formatDate(month.ms, { utc: true, style: 'month' }),
          count: countText(month.photos, month.videos),
          top,
          headH,
          bodyH,
          height: headH + bodyH + geo.end,
          rows,
          chunks: [],
          el: null
        }
        for (let at = 0; at < rows.length; at += geo.rowsPerChunk) {
          const part = rows.slice(at, at + geo.rowsPerChunk)
          const last = part[part.length - 1]
          const chunk = { section, rows: part, y: part[0].y, height: last.y + last.height - part[0].y, el: null, rendered: false }
          for (const row of part) row.chunk = chunk
          section.chunks.push(chunk)
        }
        for (const row of rows) {
          const rowIndex = flatRows.length
          const rowItems = []
          for (const segment of row.segments) {
            for (let at = segment.start; at < segment.start + segment.count; at++) {
              const item = segment.day.items[at]
              positions.set(item.path, { index: index++, section, row, rowIndex, col: rowItems.length })
              rowItems.push(item)
            }
          }
          flatRows.push(rowItems)
        }
        sections.push(section)
        top += section.height
      }
      element.classList.toggle('is-compact', geo.compact)
      element.style.setProperty('--hd-ph-size', px(geo.size))
      element.style.setProperty('--hd-ph-gap', px(geo.gap))
      element.style.setProperty('--hd-ph-label-h', px(geo.labelH))
      element.style.setProperty('--hd-ph-head-h', px(geo.headH))
      element.style.height = px(top)
    }

    function buildSection (section) {
      const body = h('div', { class: 'hd-ph-body', style: { height: px(section.bodyH) } })
      section.el = h('section', { class: 'hd-ph-section', style: { height: px(section.height) } },
        section.headH
          ? h('div', { class: 'hd-ph-month' },
            h('h2', { class: 'hd-ph-month-name' }, section.label),
            h('span', { class: 'hd-ph-month-count' }, section.count))
          : null,
        body)
      for (const chunk of section.chunks) {
        chunk.el = h('div', { class: 'hd-ph-chunk', style: { top: px(chunk.y), height: px(chunk.height) } })
        chunkOf.set(chunk.el, chunk)
        body.append(chunk.el)
        near.observe(chunk.el)
        far.observe(chunk.el)
      }
      return section.el
    }

    function tileFor (item, spare) {
      let tile = spare && spare.get(item.path)
      if (tile) spare.delete(item.path)
      else tile = makeTile(item)
      tiles.set(item.path, tile)
      return tile
    }

    function dayLine (segment) {
      const day = segment.day
      const width = segment.count * geo.size + (segment.count - 1) * geo.gap
      const text = day.place && width >= 140 ? `${day.label} · ${day.place}` : day.label
      return h('div', { class: 'hd-ph-day', title: day.title }, text)
    }

    function fill (chunk, spare) {
      if (!alive || chunk.rendered || !chunk.el) return
      chunk.rendered = true
      const rows = document.createDocumentFragment()
      for (const row of chunk.rows) {
        const rowEl = h('div', { class: 'hd-ph-row', style: { top: px(row.y - chunk.y) } })
        for (const segment of row.segments) {
          const strip = h('div', { class: 'hd-ph-strip' })
          for (let at = segment.start; at < segment.start + segment.count; at++) strip.append(tileFor(segment.day.items[at], spare).el)
          rowEl.append(h('div', { class: 'hd-ph-seg' }, row.label ? dayLine(segment) : null, strip))
        }
        rows.append(rowEl)
      }
      chunk.el.append(rows)
    }

    function empty (chunk) {
      if (!chunk.rendered || !chunk.el) return
      chunk.rendered = false
      for (const row of chunk.rows) {
        for (const segment of row.segments) {
          for (let at = segment.start; at < segment.start + segment.count; at++) {
            const path = segment.day.items[at].path
            const tile = tiles.get(path)
            if (!tile || !chunk.el.contains(tile.el)) continue
            tiles.delete(path)
            releaseTile(tile)
          }
        }
      }
      chunk.el.replaceChildren()
    }

    // The chunks on screen now, without waiting for the observers.
    function fillVisible (spare) {
      if (!alive || !geo) return
      const top = element.getBoundingClientRect().top
      const from = -top - FILL_MARGIN
      const to = -top + window.innerHeight + FILL_MARGIN
      for (const section of sections) {
        if (section.top + section.height < from) continue
        if (section.top > to) break
        for (const chunk of section.chunks) {
          const chunkTop = section.top + section.headH + chunk.y
          if (chunkTop + chunk.height >= from && chunkTop <= to) fill(chunk, spare)
        }
      }
    }

    // The photos on screen below the month's header, top first, with where
    // each is and which month it was in.
    function onScreen () {
      if (window.scrollY < 1 || !geo) return []
      const sticky = barHeight() + geo.headH
      const found = []
      for (const tile of tiles.values()) {
        if (!tile.el.isConnected) continue
        const rect = tile.el.getBoundingClientRect()
        if (rect.top < sticky || rect.top >= window.innerHeight) continue
        const at = positions.get(tile.item.path)
        found.push({ item: tile.item, top: rect.top, index: at ? at.index : 0, month: at ? at.section.key : null })
      }
      return found.sort((a, b) => (Math.abs(a.top - b.top) > 1 ? a.top - b.top : a.index - b.index))
    }

    // The photo that keeps its place: the first on screen whose date did not
    // change, else one that stayed in its month. When every photo on screen
    // went elsewhere, none: following one could jump years.
    function pickAnchor (seen, changed) {
      const kept = seen.find((entry) => !changed.has(entry.item) && positions.has(entry.item.path))
      if (kept) return kept
      return seen.find((entry) => {
        const at = positions.get(entry.item.path)
        return at && at.section.key === entry.month
      }) || null
    }

    function sameAs (next) {
      if (next.length !== list.length) return false
      for (let index = 0; index < next.length; index++) {
        if (next[index] !== list[index] || dayKeyOf(next[index]) !== dayKeys[index]) return false
      }
      return true
    }

    // Lays the list out again. Tiles already on screen are moved, not made
    // again, so their pictures stay; the anchor photo keeps its place.
    function update (next, changed = NOTHING, force = false) {
      if (!alive) return
      if (geo && !force && sameAs(next)) return
      const seen = onScreen()
      const active = document.activeElement
      const focused = active && element.contains(active) ? tileItems.get(active) : null
      const spare = tiles
      tiles = new Map()
      // The old chunks go; an observer record still on its way finds them
      // empty and without an element.
      for (const section of sections) {
        for (const chunk of section.chunks) {
          chunk.rendered = false
          if (!chunk.el) continue
          near.unobserve(chunk.el)
          far.unobserve(chunk.el)
          chunk.el = null
        }
      }
      list = next
      layout()
      element.replaceChildren(...sections.map(buildSection))
      const anchor = pickAnchor(seen, changed)
      if (anchor) {
        fill(positions.get(anchor.item.path).row.chunk, spare)
        const tile = tiles.get(anchor.item.path)
        if (tile) window.scrollBy(0, tile.el.getBoundingClientRect().top - anchor.top)
      }
      fillVisible(spare)
      for (const tile of spare.values()) releaseTile(tile)
      if (hovering && !hovering.el.isConnected) stopHover()
      if (focused) {
        const tile = tiles.get(focused.path)
        if (tile) tile.el.focus({ preventScroll: true })
      }
    }

    function resize () {
      if (geo && Math.abs(contentWidth() - geo.width) >= 0.5) update(list, NOTHING, true)
    }

    // Scrolls just enough to show an item, and focuses it if asked.
    function reveal (path, { focus = false } = {}) {
      const at = positions.get(path)
      if (!alive || !at) return
      const top = element.getBoundingClientRect().top + at.section.top + at.section.headH + at.row.y + (at.row.label ? geo.labelH : 0)
      const sticky = barHeight() + at.section.headH
      if (top < sticky) window.scrollBy(0, top - sticky - (at.row.label ? geo.labelH : geo.gap * 2))
      else if (top + geo.size > window.innerHeight) window.scrollBy(0, top + geo.size - window.innerHeight + 16)
      fill(at.row.chunk)
      fillVisible()
      const tile = tiles.get(path)
      if (focus && tile) tile.el.focus({ preventScroll: true })
    }

    // Arrow keys: across in reading order, up and down by column.
    function neighbor (item, key) {
      const at = positions.get(item.path)
      if (!at) return null
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        const forward = (key === 'ArrowRight') !== rtl
        return list[at.index + (forward ? 1 : -1)] || null
      }
      const row = flatRows[at.rowIndex + (key === 'ArrowDown' ? 1 : -1)]
      return row ? row[Math.min(at.col, row.length - 1)] : null
    }

    function refreshItem (item) {
      const tile = tiles.get(item.path)
      if (tile && tile.time && Number.isFinite(item.duration)) tile.time.textContent = formatDuration(item.duration)
    }

    // Live Photos move while the mouse rests on them.
    let hoverTimer = null
    let hovering = null

    function stopHover () {
      clearTimeout(hoverTimer)
      hoverTimer = null
      if (!hovering) return
      const video = hovering.video
      hovering = null
      video.pause()
      video.removeAttribute('src')
      try {
        video.load()
      } catch {}
      video.remove()
    }

    function playMotion (el, item) {
      stopHover()
      if (!el.isConnected || !item.motion) return
      const video = h('video', { class: 'hd-ph-motion', muted: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true', tabindex: '-1' })
      hovering = { el, video }
      video.addEventListener('playing', () => video.classList.add('is-playing'), { once: true })
      video.addEventListener('ended', stopHover, { once: true })
      video.addEventListener('error', stopHover, { once: true })
      video.setAttribute('src', source.fileUrl(host, item.motion.path))
      el.append(video)
      video.play().catch(() => {})
    }

    element.addEventListener('pointerover', (event) => {
      if (event.pointerType !== 'mouse') return
      const el = event.target.closest('.hd-ph-tile')
      if (!el || (hovering && hovering.el === el)) return
      stopHover()
      const item = tileItems.get(el)
      if (item && item.motion) hoverTimer = setTimeout(() => playMotion(el, item), 350)
    })
    element.addEventListener('pointerout', (event) => {
      const el = event.target.closest('.hd-ph-tile')
      if (el && !(event.relatedTarget && el.contains(event.relatedTarget))) stopHover()
    })
    element.addEventListener('click', (event) => {
      const el = event.target.closest('.hd-ph-tile')
      const item = el && tileItems.get(el)
      if (!item) return
      stopHover()
      onOpen(item)
    })
    element.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      const el = event.target.closest && event.target.closest('.hd-ph-tile')
      const item = el && tileItems.get(el)
      if (!item) return
      event.preventDefault()
      const target = neighbor(item, event.key)
      if (target) reveal(target.path, { focus: true })
    })

    function destroy () {
      alive = false
      stopHover()
      near.disconnect()
      far.disconnect()
      for (const tile of tiles.values()) releaseTile(tile)
      tiles.clear()
    }

    return {
      element,
      update,
      resize,
      reveal,
      refreshItem,
      fillVisible: () => fillVisible(),
      destroy,
      get list () {
        return list
      }
    }
  }

  // ---------- The lightbox ----------

  function lightboxItem (item) {
    return { path: item.path, size: item.entry.size, mtime: item.entry.mtime, kind: item.kind, motion: item.motion }
  }

  function openList (list, index, { fromHash = false } = {}) {
    lastShown = list[index].path
    box = ctx.openLightbox(list.map(lightboxItem), index, {
      fromHash,
      onChange: (at, shown) => {
        lastShown = shown.path
      },
      // Back on the grid, the photo last seen is on screen and focused.
      onClose: () => {
        box = null
        if (scope && scope.timeline && lastShown) scope.timeline.reveal(lastShown, { focus: true })
      }
    })
  }

  function openItem (item) {
    const list = scope && scope.list ? scope.list() : order
    const index = list.indexOf(item)
    if (index !== -1) openList(list, index)
  }

  // #item=<path> when the page opens, and again on Forward. A Live Photo's
  // moving part opens its photo.
  function openFromHash (hash) {
    const path = typeof hash.item === 'string' ? hash.item : null
    if (!path || (box && !box.closed)) return
    const find = (list) => {
      const at = list.findIndex((item) => item.path === path)
      return at !== -1 ? at : list.findIndex((item) => item.motion && item.motion.path === path)
    }
    let list = scope && scope.list ? scope.list() : order
    let index = find(list)
    if (index === -1) {
      list = order
      index = find(list)
    }
    if (index !== -1) openList(list, index, { fromHash: true })
  }

  // ---------- Photos ----------

  function othersSection () {
    const others = (classification.others || []).filter((path) => lib.byPath.has(path) && path.startsWith(base))
    if (!others.length) return null
    const rows = others.map((path) => {
      const entry = lib.byPath.get(path)
      const folder = folderOf(path)
      const where = folder === base ? '' : displayName(folder.slice(base.length, -1))
      const hash = { item: path }
      return h('li', null, h('a', {
        class: 'hd-ph-other',
        href: routeHref({ view: 'files', host, path: folder, hash }),
        onClick: (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          ctx.navigate({ view: 'files', path: folder, hash })
        }
      },
      kindBadge(kindOf(path, entry.size)),
      h('span', { class: 'hd-ph-other-text' },
        h('span', { class: 'hd-ph-other-name' }, displayName(fileName(path))),
        h('span', { class: 'hd-ph-other-meta' }, [formatBytes(entry.size), where].filter(Boolean).join(' · ')))))
    })
    return h('section', { class: 'hd-ph-others' },
      h('h2', { class: 'hd-ph-others-title' }, t('Also in this folder')),
      h('ul', { class: 'hd-ph-others-list' }, rows),
      button({ label: t('Show in Files'), icon: 'folder', variant: 'quiet', small: true, onClick: () => ctx.navigate({ view: 'files' }) }))
  }

  function libraryScope () {
    const timeline = createTimeline({ onOpen: openItem })
    replace(view, head(), timeline.element, othersSection())
    timeline.update(order)
    return {
      timeline,
      list: () => order,
      refresh (changed, labels) {
        timeline.update(order, changed, labels)
      },
      destroy () {
        timeline.destroy()
      }
    }
  }

  // ---------- Albums ----------

  // A card for each folder with photos or clips in it, newest first.
  function albumList () {
    const groups = new Map()
    for (const item of order) {
      if (item.folder === base) continue
      let album = groups.get(item.folder)
      if (!album) {
        album = { path: item.folder, name: displayName(fileName(item.folder)), items: [], where: '' }
        groups.set(item.folder, album)
      }
      album.items.push(item)
    }
    const albums = [...groups.values()]
    const names = new Map()
    for (const album of albums) names.set(album.name.toLowerCase(), (names.get(album.name.toLowerCase()) || 0) + 1)
    // Two albums with one name: each says which folder it is in.
    for (const album of albums) {
      if (names.get(album.name.toLowerCase()) > 1) album.where = displayName(parentPath(album.path).slice(base.length, -1))
    }
    const newest = (album) => (album.items[0].ms === null ? -Infinity : album.items[0].ms)
    return albums.sort((a, b) => newest(b) - newest(a) || naturalCompare(a.name, b.name))
  }

  // The newest photo, else the newest one this engine can draw, else the
  // newest in a format every engine draws, else a clip.
  function coverItems (list) {
    const photos = list.filter((item) => item.kind === 'image')
    const picks = [
      photos[0],
      photos.find((item) => thumbs.canShowOriginal(item.entry)),
      photos.find((item) => DRAWN_EVERYWHERE.has(extensionOf(item.path))),
      photos[1],
      photos[2],
      list.find((item) => item.kind === 'video')
    ]
    return [...new Set(picks.filter(Boolean))]
  }

  function card ({ list, title, meta, onOpen }) {
    const img = h('img', { class: 'hd-ph-img', alt: '', draggable: 'false', decoding: 'async' })
    const cover = h('span', { class: 'hd-ph-cover' }, img, h('span', { class: 'hd-ph-format', 'aria-hidden': 'true' }, icon('image')))
    const metaEl = h('span', { class: 'hd-ph-card-meta' }, meta)
    const el = h('button', { type: 'button', class: 'hd-ph-card', onClick: onOpen }, cover,
      h('span', { class: 'hd-ph-card-title' }, title),
      metaEl)
    const candidates = coverItems(list)
    let at = 0
    const next = () => {
      const item = candidates[at++]
      if (!item) {
        cover.classList.add('is-missing')
        return
      }
      attachPicture(img, item, (url) => {
        if (url) showPicture(img, cover, url)
        else next()
      })
    }
    next()
    return { el, metaEl }
  }

  function cardGrid (grid, cards, make) {
    const width = grid.clientWidth || window.innerWidth
    const compact = width < 560
    const cols = compact ? 2 : Math.max(3, Math.min(7, Math.floor(width / 210)))
    const gap = compact ? 12 : 18
    grid.style.setProperty('--hd-ph-card-cols', String(cols))
    const cardWidth = (width - gap * (cols - 1)) / cols
    const lazy = lazyChunks({
      container: grid,
      count: cards.length,
      size: cols * 6,
      className: 'hd-chunk hd-ph-card-chunk',
      estimate: (start, end) => Math.ceil((end - start) / cols) * (cardWidth + 58 + gap),
      render: (chunk, start, end) => {
        for (let index = start; index < end; index++) chunk.append(make(cards[index]))
      },
      release: (chunk) => thumbs.detachWithin(chunk)
    })
    return { lazy, width }
  }

  function cardsScope (draw) {
    const grid = h('div', { class: 'hd-ph-cards' })
    replace(view, head(), h('div', { class: 'hd-ph-cards-wrap' }, grid))
    let made = null
    const render = () => {
      if (made) made.lazy.destroy()
      thumbs.detachWithin(grid)
      grid.replaceChildren()
      made = draw(grid)
    }
    render()
    return {
      render,
      resize () {
        if (made && Math.abs((grid.clientWidth || window.innerWidth) - made.width) >= 1) render()
      },
      destroy () {
        if (made) made.lazy.destroy()
        thumbs.detachWithin(grid)
      }
    }
  }

  function albumsScope () {
    // The order is fixed while the cards are on screen.
    const albums = albumList()
    const cards = cardsScope((grid) => cardGrid(grid, albums, (album) => card({
      list: album.items,
      title: album.name,
      meta: album.where ? `${countOf(album.items)} · ${album.where}` : countOf(album.items),
      onOpen: () => go({ tab: 'albums', album: album.path, place: null }, { push: true })
    }).el))
    return { resize: cards.resize, destroy: cards.destroy }
  }

  function albumScope (path) {
    const album = albumList().find((other) => other.path === path)
    const title = h('h2', { class: 'hd-ph-scope-title' }, album.name)
    const sub = h('p', { class: 'hd-ph-scope-sub' })
    const timeline = createTimeline({ onOpen: openItem })
    replace(view, scopeHead({
      back: t('Albums'),
      backLabel: t('Back to albums'),
      onBack: () => back({ tab: 'albums', album: null, place: null }),
      title,
      sub,
      actions: button({ label: t('Show in Files'), icon: 'folder', variant: 'quiet', small: true, onClick: () => ctx.navigate({ view: 'files', path }) })
    }), timeline.element)
    let current = []
    const draw = (changed, labels) => {
      current = order.filter((item) => item.folder === path)
      sub.textContent = [countOf(current), rangeText(current)].filter(Boolean).join(' · ')
      timeline.update(current, changed, labels)
    }
    draw()
    return {
      timeline,
      list: () => current,
      refresh: draw,
      destroy () {
        timeline.destroy()
      }
    }
  }

  // ---------- Places ----------

  // Located photos by the town they are near, most photos first, then one
  // group for the rest, named by their country when they share one.
  function placeGroups () {
    const groups = new Map()
    const elsewhere = { key: ELSEWHERE, items: [], countries: new Set(), label: '' }
    for (const item of order) {
      if (!item.gps || item.place === undefined) continue
      if (!item.place) {
        elsewhere.items.push(item)
        elsewhere.countries.add(item.country || '')
        continue
      }
      const key = placeKey(item.place)
      let group = groups.get(key)
      if (!group) {
        group = { key, items: [], label: placeName(item.place) }
        groups.set(key, group)
      }
      group.items.push(item)
    }
    const list = [...groups.values()].sort((a, b) => b.items.length - a.items.length || naturalCompare(a.label, b.label))
    if (elsewhere.items.length) {
      const [only] = elsewhere.countries
      elsewhere.label = elsewhere.countries.size === 1 && only ? t('Somewhere in {country}', { country: regionName(only) }) : t('Other places')
      list.push(elsewhere)
    }
    return list
  }

  function waiting () {
    return h('div', { class: 'hd-ph-waiting' }, h('span', { class: 'hd-spinner', 'aria-hidden': 'true' }), h('span', null, t('Finding places...')))
  }

  function placesScope () {
    let shown = ''
    let metas = new Map()
    const cards = cardsScope((grid) => {
      const groups = placeGroups()
      shown = groups.map((group) => group.key).join('\n')
      metas = new Map()
      if (!groups.length) {
        grid.append(waiting())
        return { lazy: { destroy () {} }, width: grid.clientWidth || window.innerWidth }
      }
      return cardGrid(grid, groups, (group) => {
        const made = card({
          list: group.items,
          title: group.label,
          meta: countOf(group.items),
          onOpen: () => go({ tab: 'places', album: null, place: group.key }, { push: true })
        })
        metas.set(group.key, made.metaEl)
        return made.el
      })
    })
    return {
      // New places are drawn again; counts that grow change in place.
      refresh () {
        const groups = placeGroups()
        if (!groups.length && !placesPending()) {
          setTimeout(() => go(PHOTOS), 0)
          return
        }
        if (groups.map((group) => group.key).join('\n') !== shown) {
          cards.render()
          return
        }
        for (const group of groups) {
          const metaEl = metas.get(group.key)
          if (metaEl) metaEl.textContent = countOf(group.items)
        }
      },
      resize: cards.resize,
      destroy: cards.destroy
    }
  }

  function placeScope (key) {
    const title = h('h2', { class: 'hd-ph-scope-title' })
    const sub = h('p', { class: 'hd-ph-scope-sub' })
    const timeline = createTimeline({ onOpen: openItem })
    const wait = waiting()
    replace(view, scopeHead({
      back: t('Places'),
      backLabel: t('Back to places'),
      onBack: () => back({ tab: 'places', album: null, place: null }),
      title,
      sub
    }), wait, timeline.element)
    let current = []
    const draw = (changed, labels) => {
      const group = placeGroups().find((other) => other.key === key)
      if (!group) {
        // Not found yet while places are still being read; then gone.
        if (!placesPending()) setTimeout(() => go({ tab: 'places', album: null, place: null }), 0)
        return
      }
      wait.hidden = true
      title.textContent = group.label
      current = group.items
      sub.textContent = [countOf(current), rangeText(current)].filter(Boolean).join(' · ')
      timeline.update(current, changed, labels)
    }
    draw()
    return {
      timeline,
      list: () => current,
      refresh: draw,
      destroy () {
        timeline.destroy()
      }
    }
  }

  // ---------- Start ----------

  const onResize = debounce(() => {
    if (destroyed || !scope) return
    if (scope.timeline) scope.timeline.resize()
    if (scope.resize) scope.resize()
  }, 120)
  const resizeObserver = new ResizeObserver(() => onResize())
  resizeObserver.observe(view)

  show(stateFrom(route.hash), { initial: true })
  if (pendingPlaces) scheduleFlush(0)
  startReading()
  openFromHash(route.hash)

  return {
    onHash (hash) {
      const wanted = stateFrom(hash)
      if (!sameState(wanted, state)) {
        pushedScope = false
        show(wanted)
      }
      openFromHash(hash)
    },
    unmount () {
      destroyed = true
      clearTimeout(flushTimer)
      clearTimeout(statusTimer)
      onResize.cancel()
      resizeObserver.disconnect()
      save()
      if (scope) scope.destroy()
      scope = null
      progressEl.remove()
      thumbs.detachWithin(view)
    }
  }
}
