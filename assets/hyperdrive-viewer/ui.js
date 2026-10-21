/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { t, msg, tKey } from '/hyperdrive/viewer/i18n.js'

// Small DOM helpers every view uses. h() is the only way the viewer makes
// elements: text always goes in as text, attributes are checked against a
// list, and a URL attribute only takes a URL of a kind the viewer builds
// itself. Nothing here ever parses HTML.

const SVG_NS = 'http://www.w3.org/2000/svg'

const ATTRIBUTES = new Set([
  'id', 'role', 'title', 'alt', 'type', 'tabindex', 'name', 'placeholder', 'for', 'autocomplete',
  'spellcheck', 'inputmode', 'enterkeyhint', 'loading', 'decoding', 'draggable', 'width', 'height',
  'lang', 'dir', 'min', 'max', 'step', 'preload', 'kind', 'srclang', 'label', 'download', 'rel',
  'target', 'crossorigin', 'aria-label', 'aria-hidden', 'aria-expanded', 'aria-haspopup',
  'aria-controls', 'aria-current', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-live',
  'aria-modal', 'aria-labelledby', 'aria-describedby', 'aria-busy', 'aria-valuemin', 'aria-valuemax',
  'aria-valuenow', 'aria-valuetext', 'aria-orientation', 'aria-disabled', 'aria-sort', 'aria-level',
  'aria-roledescription', 'aria-keyshortcuts', 'aria-setsize', 'aria-posinset', 'aria-rowcount',
  'aria-colcount', 'aria-rowindex', 'aria-colindex', 'accesskey', 'maxlength', 'size', 'start',
  'reversed', 'colspan', 'rowspan', 'scope', 'datetime', 'cite', 'value'
])
const BOOLEAN_ATTRIBUTES = new Set([
  'hidden', 'disabled', 'controls', 'playsinline', 'autoplay', 'loop', 'default', 'checked',
  'readonly', 'multiple', 'open', 'inert', 'required', 'selected', 'webkit-playsinline'
])
const URL_ATTRIBUTES = new Set(['href', 'src', 'poster'])

/**
 * A URL the viewer may put in href, src or poster, or null: http(s),
 * hyper, blob, peersky, its own paths and fragments, and data: images.
 */
export function safeUrl (value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.startsWith('#')) return text
  if (text.startsWith('/') && !text.startsWith('//')) return text
  if (/^data:image\/(?:png|jpeg|gif|webp|avif);/i.test(text)) return text
  let url
  try {
    url = new URL(text)
  } catch {
    return null
  }
  return ['http:', 'https:', 'hyper:', 'blob:', 'peersky:'].includes(url.protocol) ? url.href : null
}

function setProp (node, key, value) {
  if (value === undefined || value === null || value === false) return
  if (key === 'class' || key === 'className') {
    const names = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value)
    if (names) node.setAttribute('class', names)
  } else if (key === 'text') {
    node.textContent = String(value)
  } else if (key === 'style') {
    for (const [name, style] of Object.entries(value)) {
      if (style === undefined || style === null) continue
      if (name.startsWith('--')) node.style.setProperty(name, String(style))
      else node.style[name] = String(style)
    }
  } else if (key === 'dataset') {
    for (const [name, data] of Object.entries(value)) {
      if (data !== undefined && data !== null) node.dataset[name] = String(data)
    }
  } else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
    node.addEventListener(key.slice(2).toLowerCase(), value)
  } else if (key === 'muted') {
    node.muted = Boolean(value)
    node.setAttribute('muted', '')
  } else if (BOOLEAN_ATTRIBUTES.has(key)) {
    node.setAttribute(key, '')
  } else if (URL_ATTRIBUTES.has(key)) {
    const url = safeUrl(value)
    if (url) node.setAttribute(key, url)
  } else if (ATTRIBUTES.has(key) || key.startsWith('data-')) {
    node.setAttribute(key, value === true ? '' : String(value))
  } else {
    throw new Error(`h(): ${key} is not an attribute the viewer sets`)
  }
}

function appendChildren (node, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false || child === true) continue
    if (Array.isArray(child)) appendChildren(node, child)
    else if (child instanceof Node) node.append(child)
    else node.append(document.createTextNode(String(child)))
  }
}

/**
 * h('button', { class: 'hd-btn', onClick }, icon('close'), 'Close').
 * Strings become text nodes; `text` sets textContent; on<Event> listens.
 */
export function h (tag, props, ...children) {
  const node = document.createElement(tag)
  if (props) for (const [key, value] of Object.entries(props)) setProp(node, key, value)
  appendChildren(node, children)
  return node
}

/** Replaces an element's children. */
export function replace (node, ...children) {
  node.replaceChildren()
  appendChildren(node, children)
  return node
}

// Icons on a 24 px grid, drawn as strokes in currentColor. A string is a
// path; an array is [tag, attributes].
const RING = (cx, cy, r, extra = {}) => ['circle', { cx, cy, r, ...extra }]
const DOT = (cx, cy, r = 1.4) => ['circle', { cx, cy, r, fill: 'currentColor', stroke: 'none' }]
const BOX = (x, y, width, height, rx = 2) => ['rect', { x, y, width, height, rx }]
const FILLED = (d) => ['path', { d, fill: 'currentColor', stroke: 'none' }]
const SHEET = ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5']

const ICONS = {
  back: ['M15 18l-6-6 6-6'],
  forward: ['M9 18l6-6-6-6'],
  up: ['M18 15l-6-6-6 6'],
  down: ['M6 9l6 6 6-6'],
  arrowUp: ['M12 19V5M5.5 11.5L12 5l6.5 6.5'],
  close: ['M18 6L6 18M6 6l12 12'],
  more: [DOT(5, 12, 1.6), DOT(12, 12, 1.6), DOT(19, 12, 1.6)],
  folder: ['M3 7.5A2.5 2.5 0 0 1 5.5 5h3.59a1 1 0 0 1 .7.29L11.5 7h7A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z'],
  file: [...SHEET],
  image: [BOX(3, 4, 18, 16, 2.5), RING(8.5, 9.5, 1.75), 'M21 15.5l-4.5-4.5L6 20'],
  video: [BOX(2.5, 5, 19, 14, 2.5), FILLED('M10 9.2v5.6a.5.5 0 0 0 .76.43l4.6-2.8a.5.5 0 0 0 0-.86l-4.6-2.8a.5.5 0 0 0-.76.43z')],
  film: [BOX(3, 4, 18, 16, 2.5), 'M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21'],
  audio: ['M9 18V5.5l11-2V16', RING(6, 18, 3), RING(17, 16, 3)],
  text: [...SHEET, 'M8.5 13h7M8.5 16.5h4.5'],
  document: [...SHEET, 'M8.5 11.5h7M8.5 14.5h7M8.5 17.5h4'],
  markdown: [BOX(2.5, 5, 19, 14, 2.5), 'M6 15V9l3 3.5L12 9v6M17 9v6M14.8 12.8L17 15l2.2-2.2'],
  code: ['M8.5 8l-4.5 4 4.5 4M15.5 8l4.5 4-4.5 4M13.5 5.5l-3 13'],
  pdf: [...SHEET, 'M9.5 18v-6h2a1.75 1.75 0 0 1 0 3.5h-2'],
  archive: [BOX(3, 4, 18, 4.5, 1.2), 'M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4'],
  font: ['M5 19l6-14h2l6 14M8 14h8'],
  subtitle: [BOX(2.5, 5, 19, 14, 2.5), 'M6.5 12.5h4M13 12.5h4.5M6.5 15.5h11'],
  cc: [BOX(2.5, 5, 19, 14, 2.5), 'M10.5 10.3a2.2 2.2 0 1 0 0 3.4M17 10.3a2.2 2.2 0 1 0 0 3.4'],
  globe: [RING(12, 12, 9), 'M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9M12 3C9.5 5.5 8.2 8.5 8.2 12s1.3 6.5 3.8 9'],
  shape: ['M12 3.5l7.5 4.25v8.5L12 20.5l-7.5-4.25v-8.5z', RING(12, 12, 2.4)],
  grid: [BOX(3.5, 3.5, 7, 7, 1.5), BOX(13.5, 3.5, 7, 7, 1.5), BOX(3.5, 13.5, 7, 7, 1.5), BOX(13.5, 13.5, 7, 7, 1.5)],
  list: ['M9 6h11M9 12h11M9 18h11', DOT(4.5, 6, 1.25), DOT(4.5, 12, 1.25), DOT(4.5, 18, 1.25)],
  sort: ['M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5'],
  wrap: ['M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5', 'M15 16l-2 2 2 2'],
  search: [RING(11, 11, 6.5), 'M20 20l-4.2-4.2'],
  download: ['M12 4v11M7 10.5l5 5 5-5M5 20h14'],
  link: ['M10 13.5a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6M14 10.5a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6'],
  share: ['M12 3.5v12M8 7.5l4-4 4 4M7 11H6a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18 11h-1'],
  external: ['M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'],
  info: [RING(12, 12, 9), 'M12 11v5.5', DOT(12, 7.75, 1.15)],
  zoomIn: [RING(11, 11, 6.5), 'M20 20l-4.2-4.2M11 8.5v5M8.5 11h5'],
  zoomOut: [RING(11, 11, 6.5), 'M20 20l-4.2-4.2M8.5 11h5'],
  play: [FILLED('M8 5.14v13.72a1 1 0 0 0 1.52.85l11.15-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z')],
  pause: [['rect', { x: 6, y: 4.5, width: 4, height: 15, rx: 1, fill: 'currentColor', stroke: 'none' }], ['rect', { x: 14, y: 4.5, width: 4, height: 15, rx: 1, fill: 'currentColor', stroke: 'none' }]],
  next: [FILLED('M5 5.4v13.2a.8.8 0 0 0 1.24.67L15.5 13V18.5a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-2a.5.5 0 0 0-.5.5V11L6.24 4.73A.8.8 0 0 0 5 5.4z')],
  previous: [FILLED('M19 5.4v13.2a.8.8 0 0 1-1.24.67L8.5 13V18.5a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5v-13A.5.5 0 0 1 6 5h2a.5.5 0 0 1 .5.5V11l9.26-6.27A.8.8 0 0 1 19 5.4z')],
  live: [DOT(12, 12, 2.2), RING(12, 12, 5.4), RING(12, 12, 9, { 'stroke-dasharray': '0.01 2.83' })],
  copy: [BOX(8.5, 8.5, 12, 12, 2), 'M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  alert: ['M10.3 4.2L2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z', 'M12 9.5v4', DOT(12, 17, 1.1)],
  lock: [BOX(5, 10.5, 14, 10, 2.5), 'M8 10.5V8a4 4 0 0 1 8 0v2.5'],
  refresh: ['M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 4v5h-5'],
  raw: ['M8 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H16', 'M9 9.5h6M9 12.5h6M9 15.5h3.5'],
  slideshow: [BOX(3, 4, 18, 13, 2), FILLED('M10.5 8.3v4.4a.5.5 0 0 0 .77.42l3.4-2.2a.5.5 0 0 0 0-.84l-3.4-2.2a.5.5 0 0 0-.77.42z'), 'M8.5 20.5h7'],
  fullscreen: ['M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15'],
  camera: ['M4.5 7.5h3l1.6-2.4a1 1 0 0 1 .83-.45h4.14a1 1 0 0 1 .83.45L16.5 7.5h3A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5z', RING(12, 13.5, 3.5)],
  pin: ['M12 21s-6.5-5.8-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z', RING(12, 9.5, 2.3)],
  calendar: [BOX(3.5, 5, 17, 15.5, 2.5), 'M3.5 10h17M8 3v4M16 3v4'],
  clock: [RING(12, 12, 9), 'M12 7v5l3.2 2'],
  drive: [BOX(3, 13, 18, 7, 2), 'M5 13l2.2-7.2a1.5 1.5 0 0 1 1.4-1.1h6.8a1.5 1.5 0 0 1 1.4 1.1L19 13', DOT(16.5, 16.5, 1)],
  sun: [RING(12, 12, 4), 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4']
}

/** An inline SVG icon by name, hidden from screen readers. */
export function icon (name, className) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('class', className ? `hd-icon ${className}` : 'hd-icon')
  for (const part of ICONS[name] || ICONS.file) {
    const [tag, attributes] = typeof part === 'string' ? ['path', { d: part }] : part
    const node = document.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
    svg.append(node)
  }
  return svg
}

/**
 * A button with text and an optional icon.
 * variant: 'primary' (filled), 'quiet' (tinted), 'ghost' (no fill), 'overlay' (on media).
 */
export function button ({ label, icon: iconName, onClick, variant = 'quiet', title, className, disabled, small } = {}) {
  return h('button', {
    type: 'button',
    class: ['hd-btn', `hd-btn--${variant}`, small && 'hd-btn--small', className],
    title,
    disabled,
    onClick
  }, iconName ? icon(iconName) : null, label ? h('span', { class: 'hd-btn-label' }, label) : null)
}

/** A square button with only an icon; the label is its name and tooltip. */
export function iconButton (iconName, label, onClick, { className, pressed, disabled } = {}) {
  return h('button', {
    type: 'button',
    class: ['hd-icon-btn', className],
    'aria-label': label,
    title: label,
    'aria-pressed': pressed === undefined ? null : String(Boolean(pressed)),
    disabled,
    onClick
  }, icon(iconName))
}

// Kinds of file: an icon, a tint (in style.css) and a name people know.
const KINDS = {
  folder: { icon: 'folder', label: msg('Folder') },
  image: { icon: 'image', label: msg('Image') },
  raw: { icon: 'image', label: msg('RAW photo') },
  video: { icon: 'video', label: msg('Video') },
  audio: { icon: 'audio', label: msg('Audio') },
  subtitle: { icon: 'subtitle', label: msg('Subtitles') },
  text: { icon: 'text', label: msg('Text') },
  markdown: { icon: 'markdown', label: msg('Markdown') },
  pdf: { icon: 'pdf', label: msg('PDF') },
  html: { icon: 'globe', label: msg('Web page') },
  svg: { icon: 'shape', label: msg('SVG image') },
  archive: { icon: 'archive', label: msg('Archive') },
  document: { icon: 'document', label: msg('Document') },
  code: { icon: 'code', label: msg('Code') },
  font: { icon: 'font', label: msg('Font') },
  other: { icon: 'file', label: msg('File') }
}

export function kindLabel (kind) {
  return tKey((KINDS[kind] || KINDS.other).label)
}

/** The tinted square with a kind's icon, as in file lists. */
export function kindBadge (kind, className) {
  const known = KINDS[kind] ? kind : 'other'
  return h('span', { class: ['hd-kind', `hd-kind--${known}`, className], 'aria-hidden': 'true' }, icon(KINDS[known].icon))
}

let toastHost = null

/** A short message at the bottom that goes away by itself. */
export function toast (text, { duration = 2600 } = {}) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'hd-toasts', role: 'status', 'aria-live': 'polite' })
    document.body.append(toastHost)
  }
  const item = h('div', { class: 'hd-toast' }, text)
  toastHost.append(item)
  requestAnimationFrame(() => requestAnimationFrame(() => item.classList.add('is-in')))
  setTimeout(() => {
    item.classList.remove('is-in')
    setTimeout(() => item.remove(), 300)
  }, duration)
}

/** Copies text and says so. */
export async function copyWithToast (source, text) {
  const copied = await source.copy(text)
  toast(copied ? t('Link copied') : t('Could not copy the link'))
  return copied
}

// Focus stays inside an open dialog.
function trapTab (container, event) {
  if (event.key !== 'Tab') return
  const focusable = [...container.querySelectorAll('button, [href], input, select, textarea, video[controls], audio[controls], [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.disabled && !node.closest('[hidden]') && node.getClientRects().length)
  if (!focusable.length) {
    event.preventDefault()
    return
  }
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

let openMenuState = null

/** Closes the open menu, if any. */
export function closeMenu () {
  if (openMenuState) openMenuState.close()
}

/**
 * A popup menu under a button. items: [{ label, icon, onSelect, checked,
 * disabled, separator }]. Arrow keys move, Escape closes.
 */
export function openMenu (anchor, items, { label, onClose } = {}) {
  closeMenu()
  const buttons = []
  const menu = h('div', { class: 'hd-menu', role: 'menu', 'aria-label': label })
  for (const item of items) {
    if (!item) continue
    if (item.separator) {
      menu.append(h('div', { class: 'hd-menu-sep', role: 'separator' }))
      continue
    }
    if (item.heading) {
      menu.append(h('div', { class: 'hd-menu-heading' }, item.heading))
      continue
    }
    const checkable = item.checked !== undefined
    const entry = h('button', {
      type: 'button',
      class: ['hd-menu-item', item.checked && 'is-checked'],
      role: checkable ? 'menuitemradio' : 'menuitem',
      'aria-checked': checkable ? String(Boolean(item.checked)) : null,
      disabled: item.disabled,
      tabindex: '-1',
      onClick: () => {
        close()
        if (item.onSelect) item.onSelect()
      }
    },
    item.icon ? icon(item.icon) : checkable ? icon('check', item.checked ? '' : 'hd-invisible') : null,
    h('span', { class: 'hd-menu-label' }, item.label))
    buttons.push(entry)
    menu.append(entry)
  }

  document.body.append(menu)
  anchor.setAttribute('aria-expanded', 'true')

  // Below the button, lined up with its far edge, above it when there is no
  // room below, and inside the window either way.
  const place = () => {
    const box = anchor.getBoundingClientRect()
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const rtl = document.documentElement.dir === 'rtl'
    let left = rtl ? box.left : box.right - width
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    let top = box.bottom + 6
    if (top + height > window.innerHeight - 8 && box.top - height - 6 > 8) top = box.top - height - 6
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8))
    menu.style.left = `${Math.round(left)}px`
    menu.style.top = `${Math.round(top)}px`
  }
  place()
  requestAnimationFrame(() => menu.classList.add('is-open'))

  const focusAt = (index) => {
    const enabled = buttons.filter((node) => !node.disabled)
    if (!enabled.length) return
    enabled[(index + enabled.length) % enabled.length].focus()
  }
  const onKey = (event) => {
    const enabled = buttons.filter((node) => !node.disabled)
    const at = enabled.indexOf(document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(at + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(at - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(-1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      anchor.focus()
    } else if (event.key === 'Tab') {
      close()
    }
  }
  const onOutside = (event) => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) close()
  }
  const onScroll = (event) => {
    if (!menu.contains(event.target)) close()
  }

  menu.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', onScroll, true)
  const checked = buttons.findIndex((node) => node.classList.contains('is-checked'))
  focusAt(checked === -1 ? 0 : checked)

  let closed = false
  function close () {
    if (closed) return
    closed = true
    anchor.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('resize', close)
    window.removeEventListener('scroll', onScroll, true)
    menu.remove()
    if (openMenuState && openMenuState.menu === menu) openMenuState = null
    if (onClose) onClose()
  }
  openMenuState = { menu, close }
  return { close }
}

/**
 * A dialog over the page: a bottom sheet on a phone, a panel in the middle
 * on a wide window. Escape, the backdrop and close() shut it.
 * size: 'small' (actions) or 'large' (a reader).
 */
export function openSheet ({ label, header, body, footer, size = 'small', className, onClose } = {}) {
  const previous = document.activeElement
  const panel = h('div', {
    class: ['hd-sheet', `hd-sheet--${size}`, className],
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
    tabindex: '-1'
  },
  header ? h('div', { class: 'hd-sheet-header' }, header) : null,
  h('div', { class: 'hd-sheet-body' }, body),
  footer ? h('div', { class: 'hd-sheet-footer' }, footer) : null)
  const backdrop = h('div', { class: 'hd-backdrop' })
  const layer = h('div', { class: 'hd-layer' }, backdrop, panel)

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    layer.classList.remove('is-open')
    document.removeEventListener('keydown', onKey, true)
    setTimeout(() => layer.remove(), 220)
    document.documentElement.classList.remove('hd-no-scroll')
    if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true })
    if (onClose) onClose()
  }
  const onKey = (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else {
      trapTab(panel, event)
    }
  }
  backdrop.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  document.body.append(layer)
  document.documentElement.classList.add('hd-no-scroll')
  requestAnimationFrame(() => {
    layer.classList.add('is-open')
    panel.focus({ preventScroll: true })
  })
  return { element: panel, layer, close, get closed () { return closed } }
}

/** A centered message with an icon and buttons: errors, empty folders. */
export function stateView ({ icon: iconName = 'folder', title, text, actions = [], tone } = {}) {
  return h('div', { class: ['hd-state', tone && `hd-state--${tone}`] },
    h('div', { class: 'hd-state-icon' }, icon(iconName)),
    title ? h('h2', { class: 'hd-state-title' }, title) : null,
    text ? h('p', { class: 'hd-state-text' }, text) : null,
    actions.length ? h('div', { class: 'hd-state-actions' }, actions) : null)
}

/** Shimmering placeholders while a folder is listed. */
export function skeleton ({ count = 24, layout = 'grid' } = {}) {
  const box = h('div', { class: ['hd-skeleton', `hd-skeleton--${layout}`], 'aria-hidden': 'true' })
  for (let index = 0; index < count; index++) {
    box.append(h('div', { class: 'hd-skeleton-item', style: { '--hd-delay': `${(index % 12) * 60}ms` } }))
  }
  return box
}

/**
 * Renders a long run of items in chunks, each only while it is near the
 * screen, so 20,000 files cost a few hundred nodes. Each chunk is an
 * element the caller fills: render(chunk, start, end) and, when it leaves,
 * release(chunk) before it is emptied.
 * estimate(start, end) is a chunk's height in px before it has been seen.
 * eager: how many chunks to render at once (default 1).
 */
export function lazyChunks ({ container, count, size = 60, estimate, render, release, className = 'hd-chunk', margin = 1200, eager = 1 }) {
  const chunks = []
  const near = new IntersectionObserver((records) => {
    for (const record of records) {
      const chunk = record.target
      if (record.isIntersecting && !chunk.rendered) fill(chunk)
    }
  }, { rootMargin: `${margin}px 0px` })
  const far = new IntersectionObserver((records) => {
    for (const record of records) {
      const chunk = record.target
      if (!record.isIntersecting && chunk.rendered) empty(chunk)
    }
  }, { rootMargin: `${margin * 3}px 0px` })

  function fill (chunk) {
    chunk.rendered = true
    chunk.style.minHeight = ''
    render(chunk, chunk.start, chunk.end)
    requestAnimationFrame(() => {
      if (chunk.rendered && chunk.offsetHeight) chunk.measured = chunk.offsetHeight
    })
  }

  function empty (chunk) {
    if (chunk.offsetHeight) chunk.measured = chunk.offsetHeight
    if (release) release(chunk)
    chunk.rendered = false
    const height = chunk.measured || estimate(chunk.start, chunk.end)
    chunk.style.minHeight = `${height}px`
    chunk.style.containIntrinsicSize = `auto ${height}px`
    chunk.replaceChildren()
  }

  for (let start = 0; start < count; start += size) {
    const end = Math.min(count, start + size)
    const height = estimate(start, end)
    // content-visibility: auto skips painting a chunk off screen; its size
    // stays what it was, so the page does not jump.
    const chunk = h('div', { class: className, style: { minHeight: `${height}px`, containIntrinsicSize: `auto ${height}px` } })
    chunk.start = start
    chunk.end = end
    chunk.rendered = false
    chunks.push(chunk)
    container.append(chunk)
    near.observe(chunk)
    far.observe(chunk)
  }
  // The first chunks are on screen as soon as there is a screen.
  for (const chunk of chunks.slice(0, eager)) fill(chunk)

  return {
    chunks,
    /** Renders the chunk holding item `index` now, e.g. to focus it. */
    ensure (index) {
      const chunk = chunks[Math.floor(index / size)]
      if (chunk && !chunk.rendered) fill(chunk)
      return chunk
    },
    destroy () {
      near.disconnect()
      far.disconnect()
      for (const chunk of chunks) if (chunk.rendered && release) release(chunk)
    }
  }
}

export function debounce (fn, wait) {
  let timer = null
  const debounced = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), wait)
  }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

export function prefersReducedMotion () {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True on a touch screen without a mouse. */
export function isCoarsePointer () {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
}

/** Keeps focus inside `container` while Tab is pressed. */
export function keepFocusIn (container) {
  const onKey = (event) => trapTab(container, event)
  container.addEventListener('keydown', onKey)
  return () => container.removeEventListener('keydown', onKey)
}
