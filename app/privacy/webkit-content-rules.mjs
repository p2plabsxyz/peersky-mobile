export const MAX_WEBKIT_RULES_PER_LIST = 45_000

const DEFAULT_RESOURCE_TYPES = Object.freeze([
  'image',
  'style-sheet',
  'script',
  'font',
  'media',
  'svg-document',
  'raw',
  'popup'
])

const RESOURCE_TYPE_OPTIONS = new Map([
  ['image', 'image'],
  ['stylesheet', 'style-sheet'],
  ['script', 'script'],
  ['font', 'font'],
  ['media', 'media'],
  ['object', 'raw'],
  ['object-subrequest', 'raw'],
  ['xmlhttprequest', 'raw'],
  ['subdocument', 'raw'],
  ['websocket', 'raw'],
  ['ping', 'raw'],
  ['other', 'raw']
])

const SAFE_FLAG_OPTIONS = new Set(['important'])
const MAX_FILTER_LINE_LENGTH = 4 * 1024
const MAX_URL_FILTER_LENGTH = 2 * 1024

export function convertFilterListToWebKitRules (
  contents,
  { maxRules = MAX_WEBKIT_RULES_PER_LIST } = {}
) {
  if (typeof contents !== 'string') throw new TypeError('Filter list must be text.')
  if (!Number.isSafeInteger(maxRules) || maxRules < 1) {
    throw new TypeError('Invalid WebKit rule limit.')
  }

  const blocking = []
  const exceptions = []

  for (const rawLine of contents.split(/\r?\n/)) {
    if (blocking.length + exceptions.length >= maxRules * 2) break
    const rule = convertLine(rawLine)
    if (!rule) continue
    ;(rule.action.type === 'ignore-previous-rules' ? exceptions : blocking).push(rule)
  }

  const keptExceptions = exceptions.slice(0, maxRules)
  const keptBlocking = blocking.slice(0, maxRules - keptExceptions.length)
  return [...keptBlocking, ...keptExceptions]
}

export function serializeWebKitContentRules (contents, options) {
  return JSON.stringify(convertFilterListToWebKitRules(contents, options))
}

function convertLine (rawLine) {
  const line = rawLine.trim()
  if (!line || line.length > MAX_FILTER_LINE_LENGTH) return null
  if (line.startsWith('!') || line.startsWith('[')) return null
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) return null

  const exception = line.startsWith('@@')
  const body = exception ? line.slice(2) : line
  const separator = body.lastIndexOf('$')
  const pattern = separator >= 0 ? body.slice(0, separator) : body
  const optionText = separator >= 0 ? body.slice(separator + 1) : ''
  const trigger = createTrigger(pattern, optionText)
  if (!trigger) return null

  return {
    trigger,
    action: {
      type: exception ? 'ignore-previous-rules' : 'block'
    }
  }
}

function createTrigger (pattern, optionText) {
  if (!pattern || (pattern.startsWith('/') && pattern.endsWith('/'))) return null

  const resourceTypes = new Set(DEFAULT_RESOURCE_TYPES)
  let hasPositiveResourceType = false
  let loadType = null
  let ifDomain = null
  let unlessDomain = null

  for (const rawOption of optionText.split(',').filter(Boolean)) {
    const negated = rawOption.startsWith('~')
    const option = (negated ? rawOption.slice(1) : rawOption).toLowerCase()
    const resourceType = RESOURCE_TYPE_OPTIONS.get(option)

    if (resourceType) {
      if (!hasPositiveResourceType && !negated) {
        resourceTypes.clear()
        hasPositiveResourceType = true
      }
      if (negated) resourceTypes.delete(resourceType)
      else resourceTypes.add(resourceType)
      continue
    }

    if (option === 'third-party') {
      loadType = [negated ? 'first-party' : 'third-party']
      continue
    }
    if (option === 'first-party') {
      loadType = [negated ? 'third-party' : 'first-party']
      continue
    }
    if (option.startsWith('domain=')) {
      const domains = parseDomains(option.slice('domain='.length))
      if (!domains) return null
      ifDomain = domains.included
      unlessDomain = domains.excluded
      continue
    }
    if (SAFE_FLAG_OPTIONS.has(option) && !negated) continue

    // Unsupported modifiers are skipped rather than weakened into broader rules.
    return null
  }

  if (resourceTypes.size === 0) return null
  const urlFilter = createUrlFilter(pattern)
  if (!urlFilter || urlFilter.length > MAX_URL_FILTER_LENGTH) return null

  const trigger = {
    'url-filter': urlFilter,
    'url-filter-is-case-sensitive': false,
    'resource-type': [...resourceTypes]
  }
  if (loadType) trigger['load-type'] = loadType
  if (ifDomain?.length) trigger['if-domain'] = ifDomain
  if (unlessDomain?.length) trigger['unless-domain'] = unlessDomain
  return trigger
}

function parseDomains (value) {
  const included = []
  const excluded = []

  for (const item of value.split('|')) {
    const negated = item.startsWith('~')
    const domain = (negated ? item.slice(1) : item).toLowerCase()
    if (!/^(?:[*][.])?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)) return null
    const normalized = domain.startsWith('*.') ? domain : `*${domain}`
    ;(negated ? excluded : included).push(normalized)
  }

  return { included, excluded }
}

function createUrlFilter (pattern) {
  let value = pattern
  let prefix = ''
  let suffix = ''

  if (value.startsWith('||')) {
    prefix = '^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?'
    value = value.slice(2)
  } else if (value.startsWith('|')) {
    prefix = '^'
    value = value.slice(1)
  }
  if (value.endsWith('|')) {
    suffix = '$'
    value = value.slice(0, -1)
  }

  let converted = ''
  for (const character of value) {
    if (character === '*') converted += '.*'
    else if (character === '^') converted += '(?:[^A-Za-z0-9_.%-]|$)'
    else converted += escapeRegex(character)
  }

  return converted ? `${prefix}${converted}${suffix}` : null
}

function escapeRegex (character) {
  return /[\\^$.*+?()[\]{}|/]/.test(character) ? `\\${character}` : character
}
