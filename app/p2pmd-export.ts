import { File, Paths } from 'expo-file-system'
import { printToFileAsync } from 'expo-print'
import * as Sharing from 'expo-sharing'

import { t } from './i18n/i18n.mjs'

export {
  createP2pmdPaperScript,
  createP2pmdShareInfoScript,
  P2PMD_PAPER_TYPE,
  P2PMD_SHARE_INFO_TYPE,
  p2pmdExportFileName,
  readP2pmdPaper,
  readP2pmdShareInfo
} from './p2pmd-export.mjs'

// A4 in points: a research paper is laid out a page to a sheet of it.
const A4 = { width: 595, height: 842 }

/**
 * Hands an exported note to the share sheet, where it can be saved to Files,
 * sent, or opened in another app. html is the page RPC_P2PMD_EXPORT made.
 * Resolves with an error to show, or null.
 */
export async function shareP2pmdExport (html: string, fileName: string, kind: 'pdf' | 'slides', paper?: 'a4'): Promise<string | null> {
  if (!await Sharing.isAvailableAsync()) return t('Sharing is not available on this phone')

  const target = new File(Paths.cache, fileName)
  try {
    if (target.exists) target.delete()
    if (kind === 'pdf') {
      const printed = await printToFileAsync({ html, ...(paper === 'a4' && A4) })
      new File(printed.uri).move(target)
    } else {
      target.create()
      target.write(html)
    }
    await Sharing.shareAsync(target.uri, kind === 'pdf'
      ? { dialogTitle: t('Export PDF'), mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }
      : { dialogTitle: t('Export slides'), mimeType: 'text/html', UTI: 'public.html' })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
