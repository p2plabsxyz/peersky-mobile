/* eslint-env browser */
/* eslint-disable import/no-absolute-path */
import { h } from '/hyperdrive/viewer/ui.js'

// Markdown from a drive, turned into DOM nodes one by one. It never parses
// HTML: tags written into the text are left out and their words kept, so a
// README cannot run anything or reach anywhere. Links go only to http(s)
// and hyper addresses, images come only from the same drive, and both are
// checked by the caller's resolveLink and resolveImage.
//
//   renderMarkdown(text, { resolveLink, resolveImage, onLink })
//
// resolveLink(href) and resolveImage(src) return a URL to use, or null to
// show the words alone. onLink(url, event) runs on a click; returning true
// stops the browser from following the link itself.

const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}>/
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const DEFINITION = /^ {0,3}\[([^\]]{1,200})\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/
const HTML_LINE = /^ {0,3}(?:<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>[ \t]*)+$/
const TAG = /^<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/
const BARE_URL = /^(?:https?|hyper):\/\/[^\s<>"]*[^\s<>".,;:!?)\]'*_~]/
const PUNCTUATION = /[!-/:-@[-`{-~]/

const isBlank = (line) => /^[ \t]*$/.test(line)

function expandTabs (line) {
  if (!line.includes('\t')) return line
  let out = ''
  for (const char of line) {
    if (char === '\t') out += ' '.repeat(4 - (out.length % 4))
    else out += char
  }
  return out
}

function leadingSpaces (line) {
  return /^ */.exec(line)[0].length
}

function slugify (text) {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
}

function startsBlock (line) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) ||
    /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/.test(line)
}

export function renderMarkdown (source, { resolveLink, resolveImage, onLink } = {}) {
  const root = h('div', { class: 'hd-markdown' })
  const definitions = new Map()
  const usedIds = new Map()

  const text = String(source || '')
    .replace(/\r\n?/g, '\n')
    // Comments go, even across lines.
    .replace(/<!--[\s\S]*?-->/g, '')
  const lines = text.split('\n').map(expandTabs)

  // Link definitions anywhere in the text: [name]: url
  const body = []
  let inFence = null
  for (const line of lines) {
    const fence = FENCE.exec(line)
    if (inFence) {
      if (new RegExp(`^ {0,3}${inFence[0] === '`' ? '`' : '~'}{${inFence.length},}[ \\t]*$`).test(line)) inFence = null
      body.push(line)
      continue
    }
    if (fence) {
      inFence = fence[1]
      body.push(line)
      continue
    }
    const definition = DEFINITION.exec(line)
    if (definition) {
      const key = definition[1].trim().toLowerCase()
      if (!definitions.has(key)) definitions.set(key, definition[2])
      continue
    }
    body.push(line)
  }

  function link (words, href) {
    const url = href && resolveLink ? resolveLink(href) : null
    if (!url) return h('span', null, words)
    if (url.startsWith('#')) {
      return h('a', {
        href: url,
        onClick: (event) => {
          event.preventDefault()
          const target = root.querySelector(`[id="md-${CSS.escape(url.slice(1))}"]`)
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, words)
    }
    return h('a', {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      onClick: (event) => {
        if (onLink && onLink(url, event)) event.preventDefault()
      }
    }, words)
  }

  function image (alt, src) {
    const url = src && resolveImage ? resolveImage(src) : null
    if (!url) return alt ? h('span', { class: 'hd-md-alt' }, alt) : null
    const picture = h('img', { src: url, alt: alt || '', loading: 'lazy', decoding: 'async' })
    picture.addEventListener('error', () => {
      picture.replaceWith(alt ? h('span', { class: 'hd-md-alt' }, alt) : document.createTextNode(''))
    }, { once: true })
    return picture
  }

  // The end of a run of `char` starting at `at`.
  function runLength (value, at, char) {
    let end = at
    while (value[end] === char) end++
    return end - at
  }

  // Where a delimiter like ** closes, or -1.
  function findClose (value, from, delimiter) {
    const char = delimiter[0]
    let at = from
    while (at < value.length) {
      const current = value[at]
      if (current === '\\') {
        at += 2
        continue
      }
      if (current === '`') {
        const run = runLength(value, at, '`')
        const close = value.indexOf('`'.repeat(run), at + run)
        at = close === -1 ? at + run : close + run
        continue
      }
      if (current === char) {
        const run = runLength(value, at, char)
        const before = value[at - 1]
        const after = value[at + run]
        if (run >= delimiter.length && at > from && before && !/\s/.test(before) &&
          (char !== '_' || !after || !/[\p{L}\p{N}]/u.test(after))) {
          return at + run - delimiter.length
        }
        at += run
        continue
      }
      at++
    }
    return -1
  }

  // [words](destination "title"), [words][name], [name]: the end and parts.
  function linkAt (value, at) {
    let depth = 0
    let close = -1
    for (let index = at; index < value.length; index++) {
      const char = value[index]
      if (char === '\\') {
        index++
        continue
      }
      if (char === '`') {
        const run = runLength(value, index, '`')
        const end = value.indexOf('`'.repeat(run), index + run)
        if (end !== -1) index = end + run - 1
        continue
      }
      if (char === '[') depth++
      if (char === ']') {
        depth--
        if (depth === 0) {
          close = index
          break
        }
      }
    }
    if (close === -1) return null
    const words = value.slice(at + 1, close)
    if (value[close + 1] === '(') {
      let index = close + 2
      while (value[index] === ' ') index++
      let destination = ''
      if (value[index] === '<') {
        const end = value.indexOf('>', index)
        if (end === -1) return null
        destination = value.slice(index + 1, end)
        index = end + 1
      } else {
        let parens = 0
        const start = index
        while (index < value.length && !/\s/.test(value[index])) {
          if (value[index] === '(') parens++
          if (value[index] === ')') {
            if (parens === 0) break
            parens--
          }
          index++
        }
        destination = value.slice(start, index)
      }
      while (value[index] === ' ') index++
      const title = /^(?:"[^"]*"|'[^']*'|\([^)]*\))/.exec(value.slice(index))
      if (title) index += title[0].length
      while (value[index] === ' ') index++
      if (value[index] !== ')') return null
      return { words, destination, end: index + 1 }
    }
    const reference = /^\[([^\]]*)\]/.exec(value.slice(close + 1))
    if (reference) {
      const key = (reference[1] || words).trim().toLowerCase()
      if (definitions.has(key)) return { words, destination: definitions.get(key), end: close + 1 + reference[0].length }
      return null
    }
    const key = words.trim().toLowerCase()
    if (definitions.has(key)) return { words, destination: definitions.get(key), end: close + 1 }
    return null
  }

  function inline (value) {
    const out = []
    let text = ''
    const flush = () => {
      if (text) out.push(document.createTextNode(text))
      text = ''
    }
    let at = 0
    while (at < value.length) {
      const char = value[at]
      if (char === '\\') {
        const next = value[at + 1]
        if (next === '\n') {
          flush()
          out.push(h('br'))
          at += 2
          continue
        }
        if (next && PUNCTUATION.test(next)) {
          text += next
          at += 2
          continue
        }
      }
      if (char === '`') {
        const run = runLength(value, at, '`')
        let close = value.indexOf('`'.repeat(run), at + run)
        while (close !== -1 && value[close + run] === '`') close = value.indexOf('`'.repeat(run), close + run + 1)
        if (close !== -1) {
          flush()
          let code = value.slice(at + run, close).replace(/\n/g, ' ')
          if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1)
          out.push(h('code', null, code))
          at = close + run
          continue
        }
        text += '`'.repeat(run)
        at += run
        continue
      }
      if (char === '!' && value[at + 1] === '[') {
        const found = linkAt(value, at + 1)
        if (found) {
          flush()
          const picture = image(found.words.replace(/[*_`]/g, ''), found.destination)
          if (picture) out.push(picture)
          at = found.end
          continue
        }
      }
      if (char === '[') {
        const found = linkAt(value, at)
        if (found) {
          flush()
          out.push(link(inline(found.words), found.destination))
          at = found.end
          continue
        }
      }
      if (char === '<') {
        const auto = /^<((?:https?|hyper):\/\/[^\s<>]+)>/.exec(value.slice(at))
        if (auto) {
          flush()
          out.push(link(auto[1], auto[1]))
          at += auto[0].length
          continue
        }
        // A script or style block in the text goes with its contents.
        const block = /^<(script|style)\b[^>]*>/i.exec(value.slice(at))
        if (block) {
          const end = value.slice(at).search(new RegExp(`</${block[1]}\\s*>`, 'i'))
          if (end !== -1) {
            at += end + value.slice(at + end).indexOf('>') + 1
            continue
          }
        }
        const tag = TAG.exec(value.slice(at))
        if (tag) {
          // HTML is left out, never parsed; a line break stays one.
          if (/^<br\s*\/?>$/i.test(tag[0])) {
            flush()
            out.push(h('br'))
          }
          at += tag[0].length
          continue
        }
      }
      if ((char === 'h') && (at === 0 || /[\s(]/.test(value[at - 1]))) {
        const bare = BARE_URL.exec(value.slice(at))
        if (bare) {
          flush()
          out.push(link(bare[0], bare[0]))
          at += bare[0].length
          continue
        }
      }
      if (char === '*' || char === '_' || char === '~') {
        const run = runLength(value, at, char)
        const delimiter = char === '~' ? (run >= 2 ? '~~' : '') : char.repeat(Math.min(run, 2))
        const after = value[at + delimiter.length]
        const before = value[at - 1]
        const opens = delimiter && after && !/\s/.test(after) &&
          !(char === '_' && before && /[\p{L}\p{N}]/u.test(before))
        if (opens) {
          const close = findClose(value, at + delimiter.length, delimiter)
          if (close !== -1) {
            flush()
            const tag = char === '~' ? 's' : delimiter.length === 2 ? 'strong' : 'em'
            out.push(h(tag, null, inline(value.slice(at + delimiter.length, close))))
            at = close + delimiter.length
            continue
          }
        }
        text += value.slice(at, at + run)
        at += run
        continue
      }
      if (char === '\n') {
        if (/ {2,}$/.test(text)) {
          text = text.replace(/ +$/, '')
          flush()
          out.push(h('br'))
        } else {
          text += '\n'
        }
        at++
        continue
      }
      text += char
      at++
    }
    flush()
    return out
  }

  function heading (level, words) {
    const node = h(`h${level}`, null, inline(words))
    const slug = slugify(node.textContent)
    if (slug) {
      const seen = usedIds.get(slug) || 0
      usedIds.set(slug, seen + 1)
      node.setAttribute('id', `md-${seen ? `${slug}-${seen}` : slug}`)
    }
    return node
  }

  function splitRow (line) {
    let row = line.trim()
    if (row.startsWith('|')) row = row.slice(1)
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
    const cells = []
    let cell = ''
    for (let index = 0; index < row.length; index++) {
      if (row[index] === '\\' && row[index + 1] === '|') {
        cell += '|'
        index++
      } else if (row[index] === '|') {
        cells.push(cell.trim())
        cell = ''
      } else {
        cell += row[index]
      }
    }
    cells.push(cell.trim())
    return cells
  }

  function parseBlocks (blockLines) {
    const out = []
    let index = 0
    while (index < blockLines.length) {
      const line = blockLines[index]
      if (isBlank(line)) {
        index++
        continue
      }

      const fence = FENCE.exec(line)
      if (fence) {
        const marker = fence[1]
        const indent = leadingSpaces(line)
        const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`)
        const code = []
        index++
        while (index < blockLines.length && !close.test(blockLines[index])) {
          code.push(blockLines[index].slice(Math.min(indent, leadingSpaces(blockLines[index]))))
          index++
        }
        index++
        const language = (fence[2] || '').trim().split(/\s+/)[0]
        out.push(h('pre', { 'data-language': language || null }, h('code', null, code.join('\n'))))
        continue
      }

      const title = HEADING.exec(line)
      if (title) {
        out.push(heading(title[1].length, title[2] || ''))
        index++
        continue
      }

      if (RULE.test(line)) {
        out.push(h('hr'))
        index++
        continue
      }

      if (HTML_LINE.test(line)) {
        if (/<br\s*\/?>/i.test(line)) out.push(h('br'))
        index++
        continue
      }

      if (QUOTE.test(line)) {
        const quoted = []
        while (index < blockLines.length && !isBlank(blockLines[index])) {
          const current = blockLines[index]
          if (QUOTE.test(current)) quoted.push(current.replace(/^ {0,3}> ?/, ''))
          else if (startsBlock(current)) break
          else quoted.push(current)
          index++
        }
        out.push(h('blockquote', null, parseBlocks(quoted)))
        continue
      }

      const item = LIST_ITEM.exec(line)
      if (item && (item[4] !== undefined || isBlank(blockLines[index + 1] || ''))) {
        const ordered = /\d/.test(item[2])
        const bullet = ordered ? item[2].slice(-1) : item[2]
        const list = h(ordered ? 'ol' : 'ul')
        if (ordered) {
          const start = parseInt(item[2], 10)
          if (start !== 1) list.setAttribute('start', String(start))
        }
        let loose = false
        const items = []
        // An item of this same list, not of one that follows it.
        const sameList = (value) => {
          const found = LIST_ITEM.exec(value)
          return Boolean(found) && /\d/.test(found[2]) === ordered && (ordered ? found[2].slice(-1) : found[2]) === bullet
        }
        while (index < blockLines.length) {
          const current = LIST_ITEM.exec(blockLines[index])
          if (!current || !sameList(blockLines[index])) break
          const gap = current[3] ? current[3].length : 1
          const indent = current[1].length + current[2].length + (gap > 4 ? 1 : gap)
          const itemLines = [current[4] || '']
          index++
          let sawBlank = false
          while (index < blockLines.length) {
            const next = blockLines[index]
            if (isBlank(next)) {
              itemLines.push('')
              sawBlank = true
              index++
              continue
            }
            if (leadingSpaces(next) >= indent) {
              itemLines.push(next.slice(indent))
              index++
              continue
            }
            if (sawBlank || LIST_ITEM.test(next) || startsBlock(next)) break
            itemLines.push(next.trim())
            index++
          }
          while (itemLines.length && isBlank(itemLines[itemLines.length - 1])) itemLines.pop()
          if (sawBlank && index < blockLines.length && sameList(blockLines[index])) loose = true
          if (itemLines.slice(1).some(isBlank)) loose = true
          items.push(itemLines)
        }
        for (const itemLines of items) {
          const task = /^\[([ xX])\][ \t]+/.exec(itemLines[0])
          if (task) itemLines[0] = itemLines[0].slice(task[0].length)
          const blocks = parseBlocks(itemLines)
          const children = []
          for (const block of blocks) {
            if (!loose && block.tagName === 'P') children.push(...block.childNodes)
            else children.push(block)
          }
          const entry = h('li', { class: task ? 'hd-md-task' : null })
          if (task) entry.append(h('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ', 'aria-hidden': 'true' }))
          entry.append(...children)
          list.append(entry)
        }
        out.push(list)
        continue
      }

      if (line.includes('|') && index + 1 < blockLines.length && TABLE_RULE.test(blockLines[index + 1]) && blockLines[index + 1].includes('-')) {
        const head = splitRow(line)
        const aligns = splitRow(blockLines[index + 1]).map((cell) =>
          cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null)
        if (head.length === aligns.length) {
          index += 2
          const table = h('table')
          const headRow = h('tr')
          head.forEach((cell, column) => headRow.append(h('th', { style: { textAlign: aligns[column] || undefined } }, inline(cell))))
          table.append(h('thead', null, headRow))
          const tbody = h('tbody')
          while (index < blockLines.length && !isBlank(blockLines[index]) && blockLines[index].includes('|')) {
            const cells = splitRow(blockLines[index])
            const row = h('tr')
            for (let column = 0; column < head.length; column++) {
              row.append(h('td', { style: { textAlign: aligns[column] || undefined } }, inline(cells[column] || '')))
            }
            tbody.append(row)
            index++
          }
          table.append(tbody)
          out.push(h('div', { class: 'hd-md-table' }, table))
          continue
        }
      }

      if (/^ {4}/.test(line)) {
        const code = []
        while (index < blockLines.length && (/^ {4}/.test(blockLines[index]) || isBlank(blockLines[index]))) {
          code.push(blockLines[index].slice(4))
          index++
        }
        while (code.length && isBlank(code[code.length - 1])) code.pop()
        out.push(h('pre', null, h('code', null, code.join('\n'))))
        continue
      }

      // A paragraph, or a heading underlined with === or ---.
      const paragraph = [line.trim()]
      index++
      let setext = 0
      while (index < blockLines.length) {
        const next = blockLines[index]
        if (isBlank(next)) break
        if (/^ {0,3}=+[ \t]*$/.test(next)) {
          setext = 1
          index++
          break
        }
        if (/^ {0,3}-+[ \t]*$/.test(next)) {
          setext = 2
          index++
          break
        }
        if (startsBlock(next) || HTML_LINE.test(next)) break
        paragraph.push(next.replace(/^ +/, ''))
        index++
      }
      const words = paragraph.join('\n')
      if (setext) out.push(heading(setext, words))
      else {
        const node = h('p', null, inline(words))
        if (node.childNodes.length) out.push(node)
      }
    }
    return out
  }

  root.append(...parseBlocks(body))
  return root
}
