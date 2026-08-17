/* global document, MessageChannel, Node, NodeFilter, performance, requestAnimationFrame, window */

const PAGINATE_SLICE_MS = 10
const MAX_PAGES = 250
let runToken = 0

function isHeading (node) {
  return node?.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(node.tagName)
}

function isContent (node) {
  return node.nodeType !== Node.TEXT_NODE || node.textContent.trim().length > 0
}

function collapseBreaks (node) {
  if (node?.nodeType !== Node.ELEMENT_NODE) return
  const paragraphs = node.tagName === 'P' ? [node] : []
  node.querySelectorAll('p').forEach((paragraph) => paragraphs.push(paragraph))
  paragraphs.forEach((paragraph) => {
    paragraph.innerHTML = paragraph.innerHTML
      .replace(/<br\s*\/?>\s*/gi, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  })
}

function buildAuthors (nodes) {
  const rows = []
  let count = 0
  nodes.filter(isContent).forEach((node) => {
    const parts = node?.tagName === 'P'
      ? node.innerHTML.split(/<br\s*\/?>/i).map((part) => part.trim()).filter(Boolean)
      : null
    if (parts?.length) {
      rows.push(parts)
      count = Math.max(count, parts.length)
    } else if (node.textContent?.trim()) {
      rows.push([node.textContent.trim()])
      count = Math.max(count, 1)
    }
  })
  if (count === 0) return null

  const authors = document.createElement('div')
  authors.className = 'ieee-authors'
  const grid = document.createElement('div')
  grid.className = 'ieee-authors-grid'
  if (count <= 4) grid.classList.add(`ieee-authors-grid--${count}`)
  const columns = Array.from({ length: count }, () => {
    const column = document.createElement('div')
    column.className = 'ieee-author-col'
    return column
  })
  rows.forEach((parts) => parts.forEach((part, index) => {
    const paragraph = document.createElement('p')
    paragraph.innerHTML = part
    columns[index].appendChild(paragraph)
  }))
  columns.filter((column) => column.childElementCount).forEach((column) => grid.appendChild(column))
  authors.appendChild(grid)
  return authors
}

function processFigures (container) {
  Array.from(container.querySelectorAll('p > img:only-child')).forEach((image) => {
    const paragraph = image.parentElement
    const alt = image.getAttribute('alt')
    if (!paragraph || paragraph.childNodes.length !== 1 || !alt) return
    const figure = document.createElement('figure')
    figure.appendChild(image.cloneNode(true))
    const caption = document.createElement('figcaption')
    caption.className = 'ieee-figure-caption'
    caption.textContent = alt
    figure.appendChild(caption)
    paragraph.replaceWith(figure)
  })

  Array.from(container.querySelectorAll('pre')).forEach((pre) => {
    const paragraph = pre.nextElementSibling
    const emphasis = paragraph?.querySelector('em')
    if (!emphasis || paragraph.childElementCount !== 1 || paragraph.textContent.trim() !== emphasis.textContent.trim()) return
    const figure = document.createElement('figure')
    pre.replaceWith(figure)
    figure.appendChild(pre)
    const caption = document.createElement('figcaption')
    caption.className = 'ieee-figure-caption'
    caption.textContent = emphasis.textContent
    figure.appendChild(caption)
    paragraph.remove()
  })
}

function processReferences (container) {
  const references = new Map()
  Array.from(container.querySelectorAll('a')).forEach((link) => {
    const href = link.getAttribute('href') || ''
    const text = link.textContent.trim()
    if (!/^https?:\/\//i.test(href) || /^\[\d+\]$/.test(text)) return
    if (text === href || text === href.replace(/\/$/, '')) return
    if (!references.has(href)) references.set(href, references.size + 1)
    const number = references.get(href)
    const citation = document.createElement('sup')
    citation.innerHTML = `<a href="#ieee-ref-${number}">[${number}]</a>`
    link.after(citation)
  })
  if (!references.size) return

  const section = document.createElement('section')
  section.innerHTML = '<h2>References</h2>'
  const list = document.createElement('ol')
  list.className = 'ieee-reference-list'
  references.forEach((number, href) => {
    const item = document.createElement('li')
    item.id = `ieee-ref-${number}`
    item.appendChild(document.createTextNode(`[${number}] `))
    const link = document.createElement('a')
    link.href = href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = href
    item.appendChild(link)
    list.appendChild(item)
  })
  section.appendChild(list)
  container.appendChild(section)
}

function buildLayout (html) {
  const host = document.createElement('div')
  host.innerHTML = html || ''
  processFigures(host)
  processReferences(host)
  const nodes = Array.from(host.childNodes)
  const titleIndex = nodes.findIndex(isHeading)
  const layout = document.createElement('div')
  layout.className = 'ieee-paper-layout'
  const columns = document.createElement('section')
  columns.className = 'ieee-columns'

  if (titleIndex === -1) {
    nodes.forEach((node) => columns.appendChild(node))
    layout.appendChild(columns)
    return layout
  }

  const abstractIndex = nodes.findIndex((node, index) => (
    index > titleIndex && isHeading(node) && node.textContent.trim().toLowerCase() === 'abstract'
  ))
  const nextHeading = abstractIndex === -1
    ? -1
    : nodes.findIndex((node, index) => index > abstractIndex && isHeading(node))
  const frontmatter = document.createElement('section')
  frontmatter.className = 'ieee-frontmatter'
  const title = nodes[titleIndex]
  title.classList.add('ieee-title')
  frontmatter.appendChild(title)
  const authors = buildAuthors(nodes.slice(titleIndex + 1, abstractIndex === -1 ? titleIndex + 1 : abstractIndex))
  if (authors) frontmatter.appendChild(authors)
  layout.appendChild(frontmatter)

  if (abstractIndex !== -1) {
    const abstract = document.createElement('section')
    abstract.className = 'ieee-abstract-block'
    const heading = nodes[abstractIndex]
    heading.classList.add('ieee-abstract-heading')
    abstract.appendChild(heading)
    nodes.slice(abstractIndex + 1, nextHeading === -1 ? nodes.length : nextHeading).forEach((node) => {
      collapseBreaks(node)
      abstract.appendChild(node)
    })
    columns.appendChild(abstract)
  }

  const remainderStart = abstractIndex === -1 ? titleIndex + 1 : (nextHeading === -1 ? nodes.length : nextHeading)
  ;[...nodes.slice(0, titleIndex), ...nodes.slice(remainderStart)].forEach((node) => {
    collapseBreaks(node)
    columns.appendChild(node)
  })
  layout.appendChild(columns)
  return layout
}

function createPage (frontmatter = null) {
  const page = document.createElement('section')
  page.className = 'ieee-preview-page'
  if (frontmatter) page.classList.add('ieee-preview-page--first')
  const inner = document.createElement('div')
  inner.className = 'ieee-preview-page-inner'
  page.appendChild(inner)
  if (frontmatter) inner.appendChild(frontmatter)
  const columns = document.createElement('section')
  columns.className = 'ieee-columns ieee-preview-columns'
  inner.appendChild(columns)
  return { page, inner, columns }
}

function hasOverflow (inner, columns, node) {
  const boundary = columns.getBoundingClientRect()
  const probe = document.createElement('span')
  probe.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;line-height:0;font-size:0'
  probe.textContent = '\u200b'
  columns.appendChild(probe)
  const probeRect = probe.getBoundingClientRect()
  const geometryOverflow = node?.nodeType === Node.ELEMENT_NODE && Array.from(node.getClientRects()).some((rect) => (
    rect.bottom > boundary.bottom + 0.5 || rect.right > boundary.right + 0.5
  ))
  const overflow = inner.scrollHeight - inner.clientHeight > 1 ||
    columns.scrollHeight - columns.clientHeight > 1 ||
    columns.scrollWidth - columns.clientWidth > 1 ||
    probeRect.bottom > boundary.bottom + 0.5 || probeRect.right > boundary.right + 0.5 || geometryOverflow
  probe.remove()
  return overflow
}

function splitParagraph (inner, columns, paragraph) {
  if (paragraph?.nodeType !== Node.ELEMENT_NODE || paragraph.tagName !== 'P') return null
  const text = paragraph.textContent || ''
  const splitOffsets = Array.from(text.matchAll(/\s+(?=\S)/g), (match) => match.index + match[0].length)
  if (splitOffsets.length === 0) return null
  let low = 0
  let high = splitOffsets.length - 1
  let best = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const probe = cloneParagraphRange(paragraph, 0, splitOffsets[middle])
    columns.appendChild(probe)
    const fits = !hasOverflow(inner, columns, probe)
    probe.remove()
    if (fits) {
      best = splitOffsets[middle]
      low = middle + 1
    } else high = middle - 1
  }
  if (best <= 0 || best >= text.length) return null
  const fit = cloneParagraphRange(paragraph, 0, best)
  const remaining = cloneParagraphRange(paragraph, best, text.length)
  return { fit, remaining }
}

function cloneParagraphRange (paragraph, startOffset, endOffset) {
  const range = document.createRange()
  const start = findTextBoundary(paragraph, startOffset)
  const end = findTextBoundary(paragraph, endOffset)
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)

  const clone = paragraph.cloneNode(false)
  clone.appendChild(range.cloneContents())
  return clone
}

function findTextBoundary (root, targetOffset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, targetOffset)
  let node = walker.nextNode()

  while (node) {
    if (remaining <= node.data.length) return { node, offset: remaining }
    remaining -= node.data.length
    node = walker.nextNode()
  }

  return { node: root, offset: root.childNodes.length }
}

function yieldToEventLoop () {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(0)
  })
}

async function paginate (token, layout, stack) {
  const frontmatter = layout.querySelector(':scope > .ieee-frontmatter')
  const source = layout.querySelector(':scope > .ieee-columns')
  if (!source) return false
  let current = createPage(frontmatter?.cloneNode(true) || null)
  stack.appendChild(current.page)
  let sliceStartedAt = performance.now()

  for (const block of Array.from(source.childNodes).filter(isContent)) {
    let node = block.cloneNode(true)
    while (node) {
      if (token !== runToken) return false
      if (performance.now() - sliceStartedAt > PAGINATE_SLICE_MS) {
        await yieldToEventLoop()
        sliceStartedAt = performance.now()
      }
      current.columns.appendChild(node)
      if (!hasOverflow(current.inner, current.columns, node)) {
        node = null
        break
      }
      current.columns.removeChild(node)
      const split = splitParagraph(current.inner, current.columns, node)
      if (split) {
        current.columns.appendChild(split.fit)
        node = split.remaining
      } else if (!current.columns.childNodes.length) {
        current.columns.appendChild(node)
        node = null
        break
      }
      if (stack.childElementCount >= MAX_PAGES) return false
      current = createPage()
      stack.appendChild(current.page)
    }
  }
  return true
}

function fitPages (preview) {
  const pages = Array.from(preview.querySelectorAll('.ieee-preview-page'))
  if (!pages.length) return
  preview.style.removeProperty('--ieee-fit-scale')
  const style = window.getComputedStyle(preview)
  const available = preview.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
  const width = pages[0].offsetWidth || 794
  const scale = Math.max(0.25, Math.min(1, available / width * 0.985))
  preview.style.setProperty('--ieee-fit-scale', scale.toFixed(4))
  pages.forEach((page, index) => { page.style.marginBottom = index === pages.length - 1 ? '0px' : '10px' })
  preview.scrollLeft = 0
}

async function render (preview, html) {
  const token = ++runToken
  preview.classList.add('p2pmd-ieee-preview')
  const stack = document.createElement('div')
  stack.className = 'ieee-page-stack'
  const staging = document.createElement('div')
  staging.style.cssText = 'height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  staging.appendChild(stack)
  preview.appendChild(staging)
  const complete = await paginate(token, buildLayout(html), stack)
  if (!complete || token !== runToken) {
    staging.remove()
    return false
  }
  const scrollTop = preview.scrollTop
  staging.removeChild(stack)
  preview.replaceChildren(stack)
  preview.scrollTop = scrollTop
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token === runToken) fitPages(preview)
  }))
  return true
}

function clear (preview) {
  runToken += 1
  preview.classList.remove('p2pmd-ieee-preview')
  preview.style.removeProperty('--ieee-fit-scale')
}

window.P2pmdIeee = { clear, fitPages, render }
