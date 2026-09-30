import { printAsync } from 'expo-print'

import { canPrintBrowserUrl, withPrintBaseHref } from './browser-print.mjs'

export {
  BROWSER_PRINT_MESSAGE_TYPE,
  canPrintBrowserUrl,
  createBrowserPrintScript,
  parseBrowserPrintMessage,
  withPrintBaseHref
} from './browser-print.mjs'

export async function printBrowserPage (html: string, pageUrl: string): Promise<string | null> {
  if (!canPrintBrowserUrl(pageUrl)) return 'This page cannot be printed'

  try {
    await printAsync({ html: withPrintBaseHref(html, pageUrl) })
    return null
  } catch (error) {
    // iOS rejects when the sheet is closed without printing, and the message it
    // gives is not reliably distinguishable from a real failure. Closing the
    // sheet is by far the likelier reason, so this stays quiet: telling
    // somebody their print failed because they changed their mind is worse
    // than saying nothing about the rare genuine failure.
    console.warn('Printing did not complete:', error)
    return null
  }
}
