/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { h, icon, iconButton, button, kindBadge, kindLabel, toast, copyWithToast, openMenu, openSheet, stateView, lazyChunks, debounce, replace } from '/hyperdrive/viewer/ui.js'
import { t, tp, msg, tKey, formatBytes, formatDate, formatNumber, compareText } from '/hyperdrive/viewer/i18n.js'
import { kindOf, isJunk, livePhotoPairs } from '/hyperdrive/viewer/lib/kinds.js'
import { parseVideoName } from '/hyperdrive/viewer/lib/names.js'
import { renderMarkdown } from '/hyperdrive/viewer/markdown.js'
import { routeHref, decodePath, displayName, folderPath, folderTitle, parentPath, shortHost, encodePath } from '/hyperdrive/viewer/route.js'

// Files: the folder as a file browser. Folders first, then files, sorted by
// name the way people count, or by date, size or kind; a filter that looks
// in every folder below; a list or a grid with pictures; a reader for text,
// code and Markdown; a bar that plays audio; the folder's README under the
// list; and Open site for a folder that is a website.

const READ_LIMIT = 1024 * 1024
const PREFS_KEY = 'peersky-drive-views:files'
const READABLE = new Set(['text', 'markdown', 'code', 'subtitle'])
// A folder with no README but an index note (what hypercore-fetch would
// have served in place of the list) shows that one instead.
const README = ['readme.md', 'readme.markdown', 'readme', 'readme.txt', 'readme.org', 'index.md', 'index.markdown', 'index.org', 'index.gmi', 'index.gemini']
const SITE_INDEX = ['index.html', 'index.htm']

const SORTS = {
  name: { label: msg('Name'), desc: false },
  date: { label: msg('Date modified'), desc: true },
  size: { label: msg('Size'), desc: true },
  kind: { label: msg('Kind'), desc: false }
}

function loadPrefs (incognito) {
  const fallback = { sort: 'name', desc: false, layout: 'list' }
  if (incognito) return fallback
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return {
      sort: SORTS[saved.sort] ? saved.sort : fallback.sort,
      desc: typeof saved.desc === 'boolean' ? saved.desc : SORTS[saved.sort] ? SORTS[saved.sort].desc : fallback.desc,
      layout: saved.layout === 'grid' ? 'grid' : 'list'
    }
  } catch {
    return fallback
  }
}

function savePrefs (prefs, incognito) {
  if (incognito) return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {}
}

const fold = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function nameOf (path) {
  return path.replace(/\/$/, '').split('/').pop()
}

// For showing; downloads keep the name as stored.
const shownName = (path) => displayName(nameOf(path))

/** Mounts the Files view; see app.js for what ctx holds. */
export function mount (ctx) {
  const { source, route, listing, thumbs, shell } = ctx
  const host = route.host
  const base = route.path
  const incognito = source.config.incognito
  const prefs = loadPrefs(incognito)
  const live = livePhotoPairs(listing.entries, base)
  const entryByPath = new Map(listing.entries.map((entry) => [entry.path, entry]))
  let lazy = null
  let query = ''
  let items = []
  let audio = null
  let reader = null

  // This folder's own children, and every file below it for the filter.
  const folders = new Map()
  const files = []
  const below = []
  for (const entry of listing.entries) {
    const rest = entry.path.slice(base.length)
    if (!rest || isJunk('/' + rest)) continue
    const kind = kindOf(entry.path, entry.size)
    const slash = rest.indexOf('/')
    const file = { ...entry, name: displayName(rest.slice(rest.lastIndexOf('/') + 1)), kind, isFolder: false }
    below.push(file)
    if (slash === -1) {
      files.push(file)
      continue
    }
    // Every folder on the way down, for the filter, and this folder's own.
    const parts = rest.split('/').slice(0, -1)
    for (let depth = 0; depth < parts.length; depth++) {
      const path = base + parts.slice(0, depth + 1).join('/') + '/'
      let folder = folders.get(path)
      if (!folder) {
        folder = { path, name: displayName(parts[depth]), kind: 'folder', isFolder: true, top: depth === 0, count: 0, size: 0, mtime: null, site: null }
        folders.set(path, folder)
      }
      folder.count++
      folder.size += entry.size
      if (Number.isFinite(entry.mtime) && (folder.mtime === null || entry.mtime > folder.mtime)) folder.mtime = entry.mtime
      // The index file's own name: a private drive serves no index for a
      // folder, so Open site opens the file itself.
      if (depth === parts.length - 1 && SITE_INDEX.includes(file.name.toLowerCase()) && (!folder.site || file.name.toLowerCase() === 'index.html')) folder.site = file.name
    }
  }
  const ownFolders = [...folders.values()].filter((folder) => folder.top)
  const siteIndex = SITE_INDEX.map((name) => files.find((file) => file.name.toLowerCase() === name)).find(Boolean)
  const readme = README.map((name) => files.find((file) => file.name.toLowerCase() === name)).find(Boolean)
  const totalSize = below.reduce((sum, file) => sum + file.size, 0)

  // The line under the folder's name.
  const counts = []
  if (ownFolders.length) counts.push(tp({ one: '{count} folder', other: '{count} folders' }, ownFolders.length))
  if (files.length || !ownFolders.length) counts.push(tp({ one: '{count} file', other: '{count} files' }, files.length))
  shell.setSubtitle(`${counts.join(', ')}${totalSize ? ` · ${formatBytes(totalSize)}` : ''}`)

  function compare (a, b) {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    let order = 0
    if (prefs.sort === 'date') order = (a.mtime || 0) - (b.mtime || 0)
    else if (prefs.sort === 'size') order = a.size - b.size
    else if (prefs.sort === 'kind') order = compareText(kindLabel(a.kind), kindLabel(b.kind))
    if (!order) order = compareText(a.name, b.name)
    return prefs.desc ? -order : order
  }

  function visibleItems () {
    if (!query) return [...ownFolders, ...files].sort(compare)
    const needle = fold(query)
    const matches = []
    for (const folder of folders.values()) if (fold(folder.name).includes(needle)) matches.push(folder)
    for (const file of below) if (fold(file.name).includes(needle)) matches.push(file)
    return matches.sort(compare)
  }

  // Header: where we are, the filter, sort and layout.
  const crumbs = h('nav', { class: 'hd-crumbs', 'aria-label': t('Folder path') })
  const parts = base.split('/').filter(Boolean)
  const crumbList = h('ol')
  crumbList.append(h('li', null, crumbLink('/', shortHost(host), parts.length === 0, 'drive')))
  parts.forEach((part, index) => {
    const path = '/' + parts.slice(0, index + 1).join('/') + '/'
    crumbList.append(h('li', null, h('span', { class: 'hd-crumb-sep', 'aria-hidden': 'true' }, '/'), crumbLink(path, displayName(part), index === parts.length - 1)))
  })
  crumbs.append(crumbList)

  function crumbLink (path, label, isCurrent, iconName) {
    if (isCurrent) return h('span', { class: 'hd-crumb is-current', 'aria-current': 'page' }, iconName ? icon(iconName) : null, label)
    return h('a', {
      class: 'hd-crumb',
      href: routeHref({ view: 'files', host, path }),
      onClick: (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        ctx.navigate({ view: 'files', path })
      }
    }, iconName ? icon(iconName) : null, label)
  }

  const filterInput = h('input', {
    type: 'search',
    class: 'hd-search-input',
    placeholder: t('Filter'),
    'aria-label': t('Filter files in this folder and below'),
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search'
  })
  const clearFilter = iconButton('close', t('Clear filter'), () => {
    filterInput.value = ''
    setQuery('')
    filterInput.focus()
  }, { className: 'hd-search-clear' })
  clearFilter.hidden = true
  const search = h('div', { class: 'hd-search' }, icon('search', 'hd-search-icon'), filterInput, clearFilter)
  const setQuery = (value) => {
    query = value.trim()
    clearFilter.hidden = !value
    render()
  }
  const onFilter = debounce(() => setQuery(filterInput.value), 120)
  filterInput.addEventListener('input', onFilter)
  filterInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filterInput.value) {
      event.preventDefault()
      event.stopPropagation()
      filterInput.value = ''
      setQuery('')
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusItem(0)
    }
  })

  const sortButton = button({ label: tKey(SORTS[prefs.sort].label), icon: 'sort', variant: 'ghost', className: 'hd-sort-btn', onClick: () => openSort() })
  sortButton.setAttribute('aria-haspopup', 'menu')
  sortButton.setAttribute('aria-label', t('Sort by {name}', { name: tKey(SORTS[prefs.sort].label) }))
  const listButton = iconButton('list', t('List'), () => setLayout('list'), { pressed: prefs.layout === 'list' })
  const gridButton = iconButton('grid', t('Grid'), () => setLayout('grid'), { pressed: prefs.layout === 'grid' })

  function openSort () {
    openMenu(sortButton, Object.entries(SORTS).map(([key, sort]) => ({
      label: tKey(sort.label),
      checked: prefs.sort === key,
      onSelect: () => {
        if (prefs.sort === key) prefs.desc = !prefs.desc
        else {
          prefs.sort = key
          prefs.desc = sort.desc
        }
        savePrefs(prefs, incognito)
        sortButton.querySelector('.hd-btn-label').textContent = tKey(sort.label)
        sortButton.setAttribute('aria-label', t('Sort by {name}', { name: tKey(sort.label) }))
        render()
      }
    })).concat([{ separator: true }, {
      label: prefs.desc ? t('Ascending') : t('Descending'),
      icon: 'sort',
      onSelect: () => {
        prefs.desc = !prefs.desc
        savePrefs(prefs, incognito)
        render()
      }
    }]), { label: t('Sort') })
  }

  function setLayout (layout) {
    if (prefs.layout === layout) return
    prefs.layout = layout
    savePrefs(prefs, incognito)
    listButton.setAttribute('aria-pressed', String(layout === 'list'))
    gridButton.setAttribute('aria-pressed', String(layout === 'grid'))
    render()
  }

  const tools = h('div', { class: 'hd-files-tools' },
    search,
    sortButton,
    h('div', { class: 'hd-segmented', role: 'group', 'aria-label': t('Layout') }, listButton, gridButton))

  const notices = h('div', { class: 'hd-files-notices' })
  if (listing.truncated) {
    notices.append(h('p', { class: 'hd-notice' }, icon('info'), t('This drive has more files than the viewer lists. Showing the first {count}.', { count: formatNumber(50000) })))
  }
  if (siteIndex) {
    notices.append(h('div', { class: 'hd-notice hd-notice--site' },
      icon('globe'),
      h('span', null, t('This folder is a website.')),
      button({ label: t('Open site'), icon: 'external', variant: 'primary', small: true, onClick: () => source.open(host, siteIndex.path) })))
  }

  const columns = h('div', { class: 'hd-files-columns', 'aria-hidden': 'true' })
  const list = h('div', { class: 'hd-files-list', role: 'list', 'aria-label': t('Files') })
  const empty = h('div', { class: 'hd-files-empty', hidden: true })
  const readmeBox = h('section', { class: 'hd-readme', hidden: true, 'aria-label': t('Read me') })
  const view = h('div', { class: 'hd-files' },
    h('div', { class: 'hd-files-head' }, crumbs, tools),
    notices, columns, list, empty, readmeBox)
  ctx.root.append(view)
  requestAnimationFrame(() => {
    const crumbScroller = crumbs.querySelector('ol')
    if (crumbScroller) crumbScroller.scrollLeft = document.documentElement.dir === 'rtl' ? -crumbScroller.scrollWidth : crumbScroller.scrollWidth
  })

  function sortHeader () {
    const cell = (key, label, className) => h('button', {
      type: 'button',
      class: ['hd-col', className, prefs.sort === key && 'is-sorted'],
      tabindex: '-1',
      onClick: () => {
        if (prefs.sort === key) prefs.desc = !prefs.desc
        else {
          prefs.sort = key
          prefs.desc = SORTS[key].desc
        }
        savePrefs(prefs, incognito)
        sortButton.querySelector('.hd-btn-label').textContent = tKey(SORTS[key].label)
        render()
      }
    }, label, prefs.sort === key ? icon(prefs.desc ? 'down' : 'up', 'hd-col-arrow') : null)
    replace(columns,
      cell('name', t('Name'), 'hd-col-name'),
      cell('date', t('Modified'), 'hd-col-date'),
      cell('size', t('Size'), 'hd-col-size'),
      h('span', { class: 'hd-col hd-col-more' }))
  }

  function metaLine (item, { short = false } = {}) {
    if (item.isFolder) {
      const count = tp({ one: '{count} item', other: '{count} items' }, item.count)
      return item.size && !short ? `${count} · ${formatBytes(item.size)}` : count
    }
    const parts = [formatBytes(item.size)]
    if (Number.isFinite(item.mtime) && !short) parts.push(formatDate(item.mtime))
    return parts.filter(Boolean).join(' · ')
  }

  function whereLine (item) {
    // While filtering, the folder a match is in.
    if (!query) return null
    const folder = parentPath(item.path)
    if (folder === base) return null
    return h('span', { class: 'hd-row-where' }, icon('folder'), displayName(folder.slice(base.length - 1)))
  }

  function rowMenu (item, anchor) {
    const name = item.isFolder ? item.name : shownName(item.path)
    openMenu(anchor, [
      item.isFolder
        ? { label: t('Open'), icon: 'folder', onSelect: () => activate(item) }
        : { label: t('Open in new tab'), icon: 'external', onSelect: () => source.open(host, item.path) },
      item.isFolder && item.site ? { label: t('Open site'), icon: 'globe', onSelect: () => source.open(host, item.path + item.site) } : null,
      item.isFolder ? null : { label: t('Download'), icon: 'download', onSelect: () => download(item) },
      { label: t('Copy link'), icon: 'link', onSelect: () => copyWithToast(source, source.hyperUrl(host, item.path)) },
      !item.isFolder && source.platform !== 'desktop' ? { label: t('Share'), icon: 'share', onSelect: () => source.share(host, item.path, name) } : null
    ], { label: t('Actions for {name}', { name }) })
  }

  function picture (item) {
    if (item.isFolder || !(item.kind === 'image' || item.kind === 'raw' || item.kind === 'video')) return null
    const img = h('img', { class: 'hd-tile-img', alt: '', draggable: 'false', decoding: 'async' })
    const isVideo = item.kind === 'video'
    thumbs.attach(img, item, isVideo ? { kind: 'video', entries: listing.entries, prefer: 'frame' } : { kind: 'photo', entries: listing.entries })
    return img
  }

  function renderItem (item, index) {
    const name = item.isFolder ? item.name : shownName(item.path)
    const grid = prefs.layout === 'grid'
    const main = item.isFolder
      ? h('a', {
        class: 'hd-row-main',
        href: routeHref({ view: 'files', host, path: item.path }),
        'data-index': String(index),
        onClick: (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          activate(item)
        }
      })
      : h('button', { type: 'button', class: 'hd-row-main', 'data-index': String(index), onClick: () => activate(item) })

    const label = h('span', { class: 'hd-row-text' },
      h('span', { class: 'hd-row-name-line' },
        h('span', { class: 'hd-row-name', title: name }, name),
        item.isFolder && item.site ? h('span', { class: 'hd-chip', title: t('This folder is a website') }, icon('globe'), t('Site')) : null),
      whereLine(item),
      h('span', { class: 'hd-row-meta' }, metaLine(item, { short: grid })))

    if (grid) {
      const pictureNode = picture(item)
      const tile = h('span', { class: ['hd-tile-visual', `hd-tile-visual--${item.kind}`] }, kindBadge(item.kind, 'hd-tile-kind'))
      if (pictureNode) {
        tile.append(pictureNode)
        if (item.kind === 'video') tile.append(h('span', { class: 'hd-tile-play', 'aria-hidden': 'true' }, icon('play')))
        if (live.has(item.path)) tile.append(h('span', { class: 'hd-tile-live', 'aria-hidden': 'true' }, icon('live'), t('LIVE')))
        const badgeText = thumbs.badge(item)
        if (badgeText && (item.kind === 'raw' || /^(HEIC|TIFF|RAW)$/.test(badgeText))) tile.append(h('span', { class: 'hd-tile-format', 'aria-hidden': 'true' }, badgeText))
      }
      main.append(tile, label)
    } else {
      main.append(kindBadge(item.kind), label,
        h('span', { class: 'hd-cell hd-cell-date' }, Number.isFinite(item.mtime) ? formatDate(item.mtime) : ''),
        h('span', { class: 'hd-cell hd-cell-size' }, item.isFolder ? tp({ one: '{count} item', other: '{count} items' }, item.count) : formatBytes(item.size)))
    }
    main.setAttribute('aria-label', item.isFolder ? t('Folder {name}', { name }) : name)

    const more = iconButton('more', t('More actions'), (event) => {
      event.stopPropagation()
      rowMenu(item, more)
    }, { className: 'hd-row-more' })
    more.setAttribute('aria-haspopup', 'menu')
    return h('div', { class: ['hd-row', item.isFolder && 'is-folder', `hd-row--${item.kind}`], role: 'listitem' }, main, more)
  }

  function columnsFor (width) {
    const phone = width < 600
    const min = phone ? 104 : 150
    const gap = phone ? 8 : 14
    return Math.max(2, Math.floor((width + gap) / (min + gap)))
  }

  let gridColumns = 0
  function render () {
    if (lazy) {
      lazy.destroy()
      lazy = null
    }
    thumbs.detachWithin(list)
    list.replaceChildren()
    items = visibleItems()
    const grid = prefs.layout === 'grid'
    view.classList.toggle('is-grid', grid)
    view.classList.toggle('is-filtering', Boolean(query))
    columns.hidden = grid || !items.length
    if (!grid) sortHeader()

    empty.hidden = items.length > 0
    if (!items.length) {
      replace(empty, stateView({
        icon: 'search',
        title: t('Nothing matches "{query}"', { query }),
        text: t('Try a shorter word, or clear the filter.'),
        actions: [button({ label: t('Clear filter'), variant: 'quiet', onClick: () => clearFilter.click() })]
      }))
      return
    }

    const width = list.clientWidth || view.clientWidth || window.innerWidth
    gridColumns = grid ? columnsFor(width) : 1
    list.style.setProperty('--hd-cols', String(gridColumns))
    const phone = width < 600
    const rowHeight = phone ? 64 : 52
    const tileWidth = grid ? (width - (gridColumns - 1) * (phone ? 8 : 14)) / gridColumns : 0
    const size = grid ? gridColumns * 6 : 80
    lazy = lazyChunks({
      container: list,
      count: items.length,
      size,
      className: grid ? 'hd-chunk hd-chunk--grid' : 'hd-chunk',
      estimate: (start, end) => grid
        ? Math.ceil((end - start) / gridColumns) * (tileWidth + 58)
        : (end - start) * rowHeight,
      render: (chunk, start, end) => {
        for (let index = start; index < end; index++) chunk.append(renderItem(items[index], index))
      },
      release: (chunk) => thumbs.detachWithin(chunk)
    })
  }

  function focusPath (path) {
    const index = items.findIndex((other) => other.path === path)
    if (index === -1 || !lazy) return
    lazy.ensure(index)
    const target = list.querySelector(`[data-index="${index}"]`)
    if (target) {
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest' })
    }
  }

  // Arrow keys move between rows (and across a grid).
  function focusItem (index) {
    if (!lazy || index < 0 || index >= items.length) return
    lazy.ensure(index)
    const target = list.querySelector(`[data-index="${index}"]`)
    if (target) {
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'nearest' })
    }
  }
  list.addEventListener('keydown', (event) => {
    const at = event.target.closest('[data-index]')
    if (!at) return
    const index = Number(at.dataset.index)
    const across = prefs.layout === 'grid' ? gridColumns : 1
    const rtl = document.documentElement.dir === 'rtl'
    let next = null
    if (event.key === 'ArrowDown') next = index + across
    else if (event.key === 'ArrowUp') next = index - across
    else if (event.key === 'ArrowRight' && across > 1) next = index + (rtl ? -1 : 1)
    else if (event.key === 'ArrowLeft' && across > 1) next = index + (rtl ? 1 : -1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    if (next === null) return
    event.preventDefault()
    if (next < 0 && event.key === 'ArrowUp') {
      filterInput.focus()
      return
    }
    focusItem(Math.max(0, Math.min(items.length - 1, next)))
  })

  const onResize = debounce(() => {
    if (prefs.layout !== 'grid') return
    const width = list.clientWidth || window.innerWidth
    if (columnsFor(width) !== gridColumns) render()
  }, 150)
  window.addEventListener('resize', onResize)

  function download (item) {
    source.download(host, item.path, nameOf(item.path))
    if (source.platform === 'desktop') toast(t('Download started'))
  }

  // What a click on an item does.
  function activate (item, { fromHash = false } = {}) {
    if (item.isFolder) {
      ctx.navigate({ view: 'files', path: item.path })
      return
    }
    if (item.kind === 'image' || item.kind === 'raw') {
      const pictures = items.filter((other) => !other.isFolder && (other.kind === 'image' || other.kind === 'raw'))
      const group = pictures.includes(item) ? pictures : [item]
      let last = item.path
      ctx.openLightbox(group.map((other) => ({
        path: other.path,
        size: other.size,
        mtime: other.mtime,
        kind: 'image',
        motion: live.has(other.path) ? entryByPath.get(live.get(other.path)) || null : null
      })), group.indexOf(item), {
        fromHash,
        onChange: (at, shown) => { last = shown.path },
        // Back on the list, the photo last seen has the focus.
        onClose: () => requestAnimationFrame(() => focusPath(last))
      })
      return
    }
    if (item.kind === 'video') {
      const videos = items.filter((other) => !other.isFolder && other.kind === 'video')
      ctx.openPlayer(item, {
        fromHash,
        next: (current) => {
          const at = videos.findIndex((other) => other.path === current.path)
          const next = at === -1 ? null : videos[at + 1]
          if (!next) return null
          const a = parseVideoName(current.path)
          const b = parseVideoName(next.path)
          // Up Next is for the next episode, not whatever sorts next.
          if (!(a && b && a.isEpisode && b.isEpisode)) return null
          return { entry: next }
        }
      })
      return
    }
    if (item.kind === 'audio') {
      playAudio(item)
      return
    }
    if (READABLE.has(item.kind) || /\.(json|csv|tsv|log|ya?ml|ini|xml|txt)$/i.test(item.path)) {
      if (item.kind !== 'html' && item.kind !== 'svg') {
        openReader(item, { fromHash })
        return
      }
    }
    openDetails(item, { fromHash })
  }

  // Text, code and Markdown, at most the first 1 MB.
  function openReader (item, { fromHash = false } = {}) {
    if (reader) reader.close()
    const name = shownName(item.path)
    const body = h('div', { class: 'hd-reader-body' }, h('div', { class: 'hd-spinner', 'aria-label': t('Loading') }))
    const isMarkdown = item.kind === 'markdown'
    let wrap = isMarkdown || item.kind === 'text'
    const wrapButton = iconButton('wrap', t('Wrap lines'), () => {
      wrap = !wrap
      wrapButton.setAttribute('aria-pressed', String(wrap))
      body.classList.toggle('is-wrapped', wrap)
    }, { pressed: wrap, className: 'hd-reader-wrap' })
    wrapButton.hidden = isMarkdown
    body.classList.toggle('is-wrapped', wrap)
    const controller = new AbortController()
    const moreButton = iconButton('more', t('More actions'), () => openMenu(moreButton, [
      { label: t('Download'), icon: 'download', onSelect: () => download(item) },
      { label: t('Copy link'), icon: 'link', onSelect: () => copyWithToast(source, source.hyperUrl(host, item.path)) },
      { label: t('Open in new tab'), icon: 'external', onSelect: () => source.open(host, item.path) },
      source.platform !== 'desktop' ? { label: t('Share'), icon: 'share', onSelect: () => source.share(host, item.path, name) } : null
    ], { label: t('More actions') }), { className: 'hd-reader-narrow' })
    moreButton.setAttribute('aria-haspopup', 'menu')
    const overlay = ctx.overlay(item.path, { fromHash, onPop: () => sheet.close() })
    const sheet = openSheet({
      label: name,
      size: 'large',
      className: 'hd-reader',
      header: [
        kindBadge(item.kind),
        h('div', { class: 'hd-reader-titles' },
          h('h2', { class: 'hd-reader-name', title: name }, name),
          h('span', { class: 'hd-reader-meta' }, metaLine(item))),
        h('div', { class: 'hd-reader-actions' },
          wrapButton,
          iconButton('download', t('Download'), () => download(item), { className: 'hd-reader-wide' }),
          iconButton('link', t('Copy link'), () => copyWithToast(source, source.hyperUrl(host, item.path)), { className: 'hd-reader-wide' }),
          iconButton('external', t('Open in new tab'), () => source.open(host, item.path), { className: 'hd-reader-wide' }),
          moreButton,
          iconButton('close', t('Close'), () => sheet.close()))
      ],
      body,
      onClose: () => {
        controller.abort()
        overlay.close()
        if (reader && reader.sheet === sheet) reader = null
      }
    })
    reader = { sheet, close: () => sheet.close() }
    source.text(host, item.path, { maxBytes: READ_LIMIT, signal: controller.signal }).then((text) => {
      if (sheet.closed) return
      const cut = item.size > READ_LIMIT
      if (/\0/.test(text.slice(0, 8192))) {
        replace(body, stateView({
          icon: 'file',
          title: t("This file doesn't look like text"),
          text: t('Download it to open it in another app.'),
          actions: [button({ label: t('Download'), icon: 'download', variant: 'primary', onClick: () => download(item) })]
        }))
        return
      }
      let content
      if (isMarkdown) {
        content = renderMarkdown(text, markdownOptions(parentPath(item.path), () => sheet.close()))
      } else {
        let shown = text
        if (/\.json$/i.test(item.path) && !cut) {
          try {
            shown = JSON.stringify(JSON.parse(text), null, 2)
          } catch {}
        }
        content = h('pre', { class: 'hd-reader-text', tabindex: '0' }, h('code', null, shown))
      }
      replace(body, content, cut ? h('p', { class: 'hd-reader-cut' }, t('Showing the first 1 MB. Download the file to see all of it.')) : null)
    }, (error) => {
      if (sheet.closed || error.name === 'AbortError') return
      replace(body, stateView({
        icon: 'alert',
        title: t("This file couldn't be read"),
        text: t('Nobody who has it answered. Try again in a moment.'),
        actions: [button({ label: t('Try again'), icon: 'refresh', variant: 'quiet', onClick: () => openReader(item) })]
      }))
    })
  }

  // Links and pictures in Markdown: http(s) and hyper links, pictures only
  // from this drive. A link to a folder or a text file of this drive opens
  // here; anything else opens in a new tab.
  function markdownOptions (folder, closeReader) {
    const baseUrl = `hyper://${host}${encodePath(folder)}`
    const drivePath = (value) => {
      let url
      try {
        url = new URL(value, baseUrl)
      } catch {
        return null
      }
      if (url.protocol !== 'hyper:' || url.host.toLowerCase() !== host) return null
      return decodePath(url.pathname)
    }
    return {
      resolveLink (href) {
        const value = String(href).trim()
        if (value.startsWith('#')) return value
        if (/^https?:\/\//i.test(value)) return value
        if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^hyper:\/\//i.test(value)) return null
        try {
          return new URL(value, baseUrl).href
        } catch {
          return null
        }
      },
      // Any picture of this drive, also outside this folder; one that is
      // not there shows its words instead (markdown.js).
      resolveImage (src) {
        const path = drivePath(String(src).trim())
        if (!path || path.endsWith('/')) return null
        const known = entryByPath.get(path)
        return kindOf(path, known ? known.size : undefined) === 'image' ? source.fileUrl(host, path) : null
      },
      onLink (url, event) {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return false
        const path = drivePath(url)
        if (path !== null) {
          const folder = folderPath(path)
          if (path.endsWith('/') || (!entryByPath.has(path) && listing.entries.some((entry) => entry.path.startsWith(folder)))) {
            closeReader()
            setTimeout(() => ctx.navigate({ view: 'files', path: folder }), 0)
            return true
          }
          const target = entryByPath.get(path)
          const targetKind = target ? kindOf(path, target.size) : null
          if (target && READABLE.has(targetKind)) {
            closeReader()
            setTimeout(() => openReader({ ...target, name: nameOf(path), kind: targetKind, isFolder: false }), 0)
            return true
          }
        }
        source.openExternal(url)
        return true
      }
    }
  }

  // Everything else: what it is, and Open, Download, Copy link.
  function openDetails (item, { fromHash = false } = {}) {
    const name = shownName(item.path)
    const overlay = ctx.overlay(item.path, { fromHash, onPop: () => sheet.close() })
    const opensElsewhere = item.kind === 'html' || item.kind === 'svg' || item.kind === 'pdf' || /\.xml$/i.test(item.path)
    const sheet = openSheet({
      label: name,
      className: 'hd-details',
      header: [
        kindBadge(item.kind, 'hd-kind--large'),
        h('div', { class: 'hd-details-titles' },
          h('h2', { class: 'hd-details-name' }, name),
          h('span', { class: 'hd-details-meta' }, `${kindLabel(item.kind)} · ${metaLine(item)}`)),
        iconButton('close', t('Close'), () => sheet.close(), { className: 'hd-details-close' })
      ],
      body: h('div', { class: 'hd-details-body' },
        opensElsewhere ? h('p', { class: 'hd-details-note' }, t('Pages and documents open in their own tab, away from your files.')) : null,
        h('div', { class: 'hd-details-actions' },
          button({ label: t('Open in new tab'), icon: 'external', variant: 'primary', onClick: () => { source.open(host, item.path); sheet.close() } }),
          button({ label: t('Download'), icon: 'download', variant: 'quiet', onClick: () => { download(item); sheet.close() } }),
          button({ label: t('Copy link'), icon: 'link', variant: 'quiet', onClick: () => { copyWithToast(source, source.hyperUrl(host, item.path)); sheet.close() } }),
          source.platform !== 'desktop' ? button({ label: t('Share'), icon: 'share', variant: 'quiet', onClick: () => { source.share(host, item.path, name); sheet.close() } }) : null)),
      onClose: () => overlay.close()
    })
  }

  // A bar at the bottom that plays the folder's audio, one after another.
  function playAudio (item) {
    const tracks = items.filter((other) => !other.isFolder && other.kind === 'audio')
    let index = Math.max(0, tracks.indexOf(item))
    if (!audio) {
      const element = h('audio', { controls: true, preload: 'metadata', class: 'hd-audio-el' })
      const title = h('span', { class: 'hd-audio-title' })
      const where = h('span', { class: 'hd-audio-where' })
      const prev = iconButton('previous', t('Previous'), () => playAt(index - 1), { className: 'hd-audio-skip' })
      const next = iconButton('next', t('Next'), () => playAt(index + 1), { className: 'hd-audio-skip' })
      const bar = h('div', { class: 'hd-audio', role: 'region', 'aria-label': t('Audio player') },
        h('span', { class: 'hd-audio-icon' }, icon('audio')),
        h('div', { class: 'hd-audio-text' }, title, where),
        prev, element, next,
        iconButton('close', t('Close player'), () => stopAudio(), { className: 'hd-audio-close' }))
      document.body.append(bar)
      document.documentElement.classList.add('has-audio-bar')
      requestAnimationFrame(() => bar.classList.add('is-open'))
      element.addEventListener('ended', () => {
        if (index < audio.tracks.length - 1) playAt(index + 1)
      })
      element.addEventListener('error', () => {
        if (element.getAttribute('src')) toast(t("This audio can't play here"))
      })
      audio = { bar, element, title, where, prev, next, tracks }
    }
    audio.tracks = tracks.length ? tracks : [item]
    function playAt (at) {
      if (!audio || at < 0 || at >= audio.tracks.length) return
      index = at
      const track = audio.tracks[at]
      const name = shownName(track.path)
      audio.title.textContent = name.replace(/\.[^.]+$/, '')
      audio.where.textContent = folderTitle(host, parentPath(track.path))
      audio.prev.disabled = at === 0
      audio.next.disabled = at === audio.tracks.length - 1
      audio.element.setAttribute('src', source.fileUrl(host, track.path))
      audio.element.play().catch(() => {})
      if ('mediaSession' in navigator && typeof window.MediaMetadata === 'function') {
        try {
          navigator.mediaSession.metadata = new window.MediaMetadata({ title: audio.title.textContent, album: audio.where.textContent })
          navigator.mediaSession.setActionHandler('previoustrack', () => playAt(index - 1))
          navigator.mediaSession.setActionHandler('nexttrack', () => playAt(index + 1))
        } catch {}
      }
    }
    playAt(index)
  }

  function stopAudio () {
    if (!audio) return
    const { bar, element } = audio
    element.pause()
    element.removeAttribute('src')
    try {
      element.load()
    } catch {}
    bar.classList.remove('is-open')
    document.documentElement.classList.remove('has-audio-bar')
    setTimeout(() => bar.remove(), 200)
    audio = null
  }

  // The folder's README, under the list.
  if (readme) {
    readmeBox.hidden = false
    const name = shownName(readme.path)
    const content = h('div', { class: 'hd-readme-body' }, h('div', { class: 'hd-spinner', 'aria-label': t('Loading') }))
    readmeBox.append(h('header', { class: 'hd-readme-head' }, icon('document'), h('span', null, name)), content)
    source.text(host, readme.path, { maxBytes: READ_LIMIT, signal: ctx.signal }).then((text) => {
      if (ctx.signal.aborted) return
      const markdown = /\.(md|markdown)$/i.test(name) || !/\./.test(name)
      replace(content, markdown
        ? renderMarkdown(text, markdownOptions(base, () => {}))
        : h('pre', { class: 'hd-reader-text' }, h('code', null, text)))
    }, () => {
      if (!ctx.signal.aborted) readmeBox.hidden = true
    })
  }

  render()

  // An item in the address (#item=/path) opens when the page does, and
  // again on Forward.
  function openFromHash (hash) {
    const path = typeof hash.item === 'string' ? hash.item : null
    if (!path || !path.startsWith(base)) return
    const item = below.find((file) => file.path === path)
    if (item) activate(item, { fromHash: true })
  }
  openFromHash(route.hash)

  return {
    onHash (hash) {
      openFromHash(hash)
    },
    unmount () {
      window.removeEventListener('resize', onResize)
      onFilter.cancel()
      onResize.cancel()
      if (lazy) lazy.destroy()
      thumbs.detachWithin(view)
      stopAudio()
      if (reader) reader.close()
    }
  }
}
