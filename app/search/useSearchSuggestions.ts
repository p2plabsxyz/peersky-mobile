import { useEffect, useRef, useState } from 'react'
import { fetch as expoFetch } from 'expo/fetch'
import {
  canSuggestSearches,
  getSearchSuggestionUrl,
  parseSearchSuggestions
} from './search-suggestions.mjs'

// Long enough to wait out the next letter, short enough to feel live.
const SUGGESTION_DELAY_MS = 150
const SUGGESTION_TIMEOUT_MS = 4000
// Backspacing over what was just typed shows its answers again without asking.
const MAX_REMEMBERED_ANSWERS = 30

/**
 * The search engine's suggestions for what is in the address bar, while the
 * bar is being typed in. Asked without cookies, so the engine gets the
 * letters and not who typed them. The last answer stays up while the next one
 * is on its way, so the list does not blink with every letter.
 */
export function useSearchSuggestions (text: string, {
  active,
  enabled,
  incognito,
  searchEngine
}: {
  active: boolean
  enabled: boolean
  incognito: boolean
  searchEngine: string
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const answersRef = useRef(new Map<string, string[]>())
  const query = text.trim()
  const url = active && canSuggestSearches(query, { enabled, incognito })
    ? getSearchSuggestionUrl(searchEngine, query)
    : null

  useEffect(() => {
    if (!url) {
      setSuggestions((current) => current.length > 0 ? [] : current)
      return
    }
    const remembered = answersRef.current.get(url)
    if (remembered) {
      setSuggestions(remembered)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      const timeout = setTimeout(() => controller.abort(), SUGGESTION_TIMEOUT_MS)
      try {
        const response = await expoFetch(url, {
          credentials: 'omit',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        })
        if (!response.ok) return
        const answer = parseSearchSuggestions(await response.text(), query) as string[]
        const answers = answersRef.current
        answers.set(url, answer)
        if (answers.size > MAX_REMEMBERED_ANSWERS) answers.delete(answers.keys().next().value as string)
        setSuggestions(answer)
      } catch {
        // Offline, slow or refused: the bar works the same without them.
      } finally {
        clearTimeout(timeout)
      }
    }, SUGGESTION_DELAY_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, url])

  return url ? suggestions : []
}
