const MAX_DIAGNOSTIC_EVENTS = 100
const MAX_DIAGNOSTIC_STRING_LENGTH = 4096
const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token)/i

const events = []

export function recordBrowserDiagnostic (area, stage, details = {}) {
  events.push({
    at: new Date().toISOString(),
    area: normalizeLabel(area),
    stage: normalizeLabel(stage),
    details: sanitizeDiagnosticValue(details)
  })

  if (events.length > MAX_DIAGNOSTIC_EVENTS) {
    events.splice(0, events.length - MAX_DIAGNOSTIC_EVENTS)
  }
}

export function createBrowserAnalysis (context = {}) {
  return {
    generatedAt: new Date().toISOString(),
    platform: sanitizeDiagnosticValue(context.platform || 'unknown'),
    context: sanitizeDiagnosticValue(context),
    events: events.map((event) => ({ ...event }))
  }
}

export function clearBrowserDiagnostics () {
  events.length = 0
}

function sanitizeDiagnosticValue (value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '<redacted>'
  if (depth > 5) return '<truncated>'
  if (value === null || value === undefined || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return sanitizeDiagnosticString(value)
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeDiagnosticValue(item, key, depth + 1))
  }
  if (typeof value !== 'object') return String(value)

  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [
    entryKey,
    sanitizeDiagnosticValue(entryValue, entryKey, depth + 1)
  ]))
}

function sanitizeDiagnosticString (value) {
  const bounded = Array.from(value).slice(0, MAX_DIAGNOSTIC_STRING_LENGTH).join('')
  try {
    const parsed = new URL(bounded)
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, '<redacted>')
    }
    return parsed.href
  } catch {
    return bounded
  }
}

function normalizeLabel (value) {
  return Array.from(String(value || 'unknown')).slice(0, 80).join('')
}
