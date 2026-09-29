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
    // Closing the dialog rejects on iOS, which is not a failure worth telling
    // anybody about. Android resolves either way.
    const message = error instanceof Error ? error.message : String(error)
    if (/cancel|dismiss/i.test(message)) return null
    return 'Could not print this page'
  }
}
