export const MAX_WEBKIT_RULES_PER_LIST = 150_000

// Bumped whenever a converter change makes the rules already on disk wrong.
// It lands in the rule filename and in the WebKit identifier, because both
// caches are keyed by the filter-list snapshot, which does not move when the
// converter does. Keep it in step with PeerSkyRuleFormatVersion in
// plugins/templates/PeerSkyContentBlocker.m.template.
export const WEBKIT_RULE_FORMAT_VERSION = 3

const DEFAULT_BATCH_SIZE = 500

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
  ['websocket', 'raw'],
  ['other', 'raw']
])

// $ping has no WebKit equivalent. It used to be widened to 'raw', which turned
// EasyPrivacy's "*$ping,third-party" into a rule that blocked every
// third-party fetch on every page: YouTube loaded its player, knew the
// duration and then sat on a spinner forever, because the media comes from
// googlevideo.com over fetch. A beacon rule is not worth that, so $ping now
// falls through to the unsupported branch and the line is skipped.
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
    for (const rule of convertLine(rawLine)) {
      ;(rule.action.type === 'ignore-previous-rules' ? exceptions : blocking).push(rule)
    }
  }

  const keptExceptions = exceptions.slice(0, maxRules)
  const keptBlocking = blocking.slice(0, maxRules - keptExceptions.length)
  return [...keptBlocking, ...keptExceptions]
}

export async function convertFilterListToWebKitRulesAsync (
  contents,
  {
    maxRules = MAX_WEBKIT_RULES_PER_LIST,
    batchSize = DEFAULT_BATCH_SIZE,
    yieldControl = yieldToEventLoop
  } = {}
) {
  if (typeof contents !== 'string') throw new TypeError('Filter list must be text.')
  validateBatchOptions(maxRules, batchSize, yieldControl)

  const blocking = []
  const exceptions = []
  const lines = contents.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    if (blocking.length + exceptions.length >= maxRules * 2) break
    for (const rule of convertLine(lines[index])) {
      ;(rule.action.type === 'ignore-previous-rules' ? exceptions : blocking).push(rule)
    }
    if ((index + 1) % batchSize === 0) await yieldControl()
  }

  const keptExceptions = exceptions.slice(0, maxRules)
  const keptBlocking = blocking.slice(0, maxRules - keptExceptions.length)
  return [...keptBlocking, ...keptExceptions]
}

export async function serializeWebKitContentRuleChunks (
  rules,
  {
    batchSize = DEFAULT_BATCH_SIZE,
    yieldControl = yieldToEventLoop
  } = {}
) {
  if (!Array.isArray(rules)) throw new TypeError('WebKit rules must be an array.')
  validateBatchOptions(1, batchSize, yieldControl)

  const chunks = []
  for (let index = 0; index < rules.length; index += batchSize) {
    const batch = JSON.stringify(rules.slice(index, index + batchSize))
    chunks.push(batch.slice(1, -1))
    await yieldControl()
  }
  return chunks
}

export function serializeWebKitContentRules (contents, options) {
  return JSON.stringify(convertFilterListToWebKitRules(contents, options))
}

function convertLine (rawLine) {
  const line = rawLine.trim()
  if (!line || line.length > MAX_FILTER_LINE_LENGTH) return []
  if (line.startsWith('!') || line.startsWith('[')) return []
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) return []

  const exception = line.startsWith('@@')
  const body = exception ? line.slice(2) : line
  const separator = body.lastIndexOf('$')
  const pattern = separator >= 0 ? body.slice(0, separator) : body
  const optionText = separator >= 0 ? body.slice(separator + 1) : ''
  const type = exception ? 'ignore-previous-rules' : 'block'

  return createTriggers(pattern, optionText).map((trigger) => ({ trigger, action: { type } }))
}

function createTriggers (pattern, optionText) {
  if (!pattern || (pattern.startsWith('/') && pattern.endsWith('/'))) return []

  const resourceTypes = new Set(DEFAULT_RESOURCE_TYPES)
  // An iframe, which WebKit loads as a document rather than as any of the
  // types above. A filter with no type covers frames too.
  let frames = true
  let hasPositiveResourceType = false
  let loadType = null
  let ifDomain = null
  let unlessDomain = null

  for (const rawOption of optionText.split(',').filter(Boolean)) {
    const negated = rawOption.startsWith('~')
    const option = (negated ? rawOption.slice(1) : rawOption).toLowerCase()
    const resourceType = RESOURCE_TYPE_OPTIONS.get(option)

    if (resourceType || option === 'subdocument') {
      if (!hasPositiveResourceType && !negated) {
        resourceTypes.clear()
        frames = false
        hasPositiveResourceType = true
      }
      if (option === 'subdocument') frames = !negated
      else if (negated) resourceTypes.delete(resourceType)
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
      if (!domains) return []
      ifDomain = domains.included
      unlessDomain = domains.excluded
      continue
    }
    if (SAFE_FLAG_OPTIONS.has(option) && !negated) continue

    // Unsupported modifiers are skipped rather than weakened into broader rules.
    return []
  }

  const urlFilter = createUrlFilter(pattern)
  if (!urlFilter || urlFilter.length > MAX_URL_FILTER_LENGTH) return []

  const triggers = []
  const withScope = (trigger) => {
    if (loadType) trigger['load-type'] = loadType
    if (ifDomain?.length) trigger['if-domain'] = ifDomain
    if (unlessDomain?.length) trigger['unless-domain'] = unlessDomain
    return trigger
  }
  if (resourceTypes.size > 0) {
    triggers.push(withScope({
      'url-filter': urlFilter,
      'url-filter-is-case-sensitive': false,
      'resource-type': [...resourceTypes]
    }))
  }
  // A document is also the page typed into the address bar, which is never
  // blocked. That page is first party to itself, so a third-party document
  // can only be a frame. A first-party-only filter has no frame rule.
  if (frames && loadType?.[0] !== 'first-party') {
    triggers.push({
      ...withScope({
        'url-filter': urlFilter,
        'url-filter-is-case-sensitive': false,
        'resource-type': ['document']
      }),
      'load-type': ['third-party']
    })
  }
  return triggers
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
    prefix = '^[a-z][a-z0-9+.-]*://([^/?#]*\\.)?'
    value = value.slice(2)
  } else if (value.startsWith('|')) {
    prefix = '^'
    value = value.slice(1)
  }
  if (value.endsWith('|')) {
    suffix = '$'
    value = value.slice(0, -1)
  }

  // WebKit's url-filter has no alternation at all: any "|" fails to compile with
  // "Disjunctions are not supported yet". The Adblock separator "^" means "a
  // separator character or the end of the URL", which needs alternation to say
  // exactly, so approximate it: a trailing separator is dropped (the end of the
  // pattern already implies the end of the URL) and anywhere else it becomes the
  // separator character class on its own.
  const characters = [...value]
  let converted = ''
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]
    if (character === '*') converted += '.*'
    else if (character === '^') {
      if (index < characters.length - 1) converted += '[^A-Za-z0-9_.%-]'
    } else converted += escapeRegex(character)
  }

  return converted ? `${prefix}${converted}${suffix}` : null
}

function escapeRegex (character) {
  // Only escape what WebKit treats as special. "/" and "{}" are literals there,
  // and escaping them fails compilation.
  return /[\\^$.*+?()[\]|]/.test(character) ? `\\${character}` : character
}

function validateBatchOptions (maxRules, batchSize, yieldControl) {
  if (!Number.isSafeInteger(maxRules) || maxRules < 1) {
    throw new TypeError('Invalid WebKit rule limit.')
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new TypeError('Invalid WebKit batch size.')
  }
  if (typeof yieldControl !== 'function') {
    throw new TypeError('Invalid WebKit yield function.')
  }
}

function yieldToEventLoop () {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
