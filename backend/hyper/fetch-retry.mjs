import { headersToObject } from './assets.mjs'

export const DEFAULT_HYPER_DISCOVERY_RETRIES = 5
export const DEFAULT_HYPER_DISCOVERY_RETRY_DELAY = 250
export const DEFAULT_HYPER_DISCOVERY_MAX_RETRY_DELAY = 2000

export async function withHyperRetry ({
  fetch,
  url,
  retries,
  retryDelay,
  maxRetryDelay,
  backoffFactor,
  readResponse
}) {
  let attempt = 0
  let currentDelay = retryDelay

  while (true) {
    try {
      const response = await fetch(url)
      const headers = headersToObject(response.headers)

      if (!response.ok) {
        let text = ''
        try {
          text = await response.text()
        } catch (_) {}

        const isRetryable = isPeerDiscoveryError(text) || response.status === 502
        if (isRetryable && attempt < retries) {
          attempt++
          await delay(currentDelay)
          currentDelay = Math.min(maxRetryDelay, Math.floor(currentDelay * backoffFactor))
          continue
        }

        return {
          ok: false,
          status: response.status,
          statusText: response.statusText,
          url: response.url || url,
          headers,
          error: text || response.statusText || `Request failed with status ${response.status}`
        }
      }

      return await readResponse(response, headers)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isRetryable = isPeerDiscoveryError(errorMsg)

      if (isRetryable && attempt < retries) {
        attempt++
        await delay(currentDelay)
        currentDelay = Math.min(maxRetryDelay, Math.floor(currentDelay * backoffFactor))
        continue
      }

      return {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        url,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        error: errorMsg
      }
    }
  }
}

export function isPeerDiscoveryError (message) {
  return /\bpeers?\s+not\s+found\b/i.test(message) ||
    /could not find data in drive[^\n]*peers online/i.test(message)
}

function delay (milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
