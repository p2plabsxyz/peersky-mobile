import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createP2pmdPaperScript,
  createP2pmdShareInfoScript,
  P2PMD_PAPER_TYPE,
  P2PMD_SHARE_INFO_TYPE,
  p2pmdExportFileName,
  readP2pmdPaper,
  readP2pmdShareInfo
} from '../../app/p2pmd-export.mjs'

const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
const sheet = await readFile(new URL('../../app/P2pmdShareSheet.tsx', import.meta.url), 'utf8')

test('only the answer to this tap is taken', () => {
  const answer = { type: P2PMD_SHARE_INFO_TYPE, nonce: 'n1', content: '# A\n\n---\n\n# B', slideBreaks: true, latexModeEnabled: false }
  assert.deepEqual(readP2pmdShareInfo(answer, 'n1'), { content: answer.content, slides: true, latexModeEnabled: false })
  assert.equal(readP2pmdShareInfo(answer, 'n2'), null)
  assert.equal(readP2pmdShareInfo(answer, null), null)
  assert.equal(readP2pmdShareInfo({ ...answer, type: 'p2pmd-publish-requested' }, 'n1'), null)
  assert.equal(readP2pmdShareInfo({ ...answer, content: 5 }, 'n1'), null)
  // Anything but a plain true is a note, not a deck.
  assert.equal(readP2pmdShareInfo({ ...answer, slideBreaks: 'yes' }, 'n1').slides, false)
})

test('the page is asked with the nonce as a string', () => {
  assert.equal(
    createP2pmdShareInfoScript('ab"</script>'),
    'window.__p2pmdShareInfo && window.__p2pmdShareInfo("ab\\"</script>"); true;'
  )
})

test('a research paper is asked of the editor for Export PDF, and printed on A4', () => {
  assert.equal(
    createP2pmdPaperScript('ab"</script>'),
    'window.__p2pmdPaperForExport && window.__p2pmdPaperForExport("ab\\"</script>"); true;'
  )
  const answer = { type: P2PMD_PAPER_TYPE, nonce: 'n1', html: '<div class="ieee-page-stack"></div>' }
  assert.deepEqual(readP2pmdPaper(answer, 'n1'), { html: answer.html })
  // A note that is not a paper answers with no pages.
  assert.deepEqual(readP2pmdPaper({ ...answer, html: null }, 'n1'), { html: null })
  assert.equal(readP2pmdPaper(answer, 'n2'), null)
  assert.equal(readP2pmdPaper({ ...answer, type: P2PMD_SHARE_INFO_TYPE }, 'n1'), null)
  // Export PDF asks for the pages first, only for a note with LaTeX mode on.
  assert.match(app, /const paperHtml = kind === 'pdf' && note\.latexModeEnabled \? await requestP2pmdPaper\(\) : null/)
  assert.match(app, /\.\.\.\(paperHtml && \{ paperHtml \}\)/)
  assert.match(app, /response\.paper === 'a4' \? 'a4' : undefined/)
})

test('an export is named as the desktop names it', () => {
  assert.equal(p2pmdExportFileName('# Trip to Pune!\n\nDay one', 'pdf'), 'trip-to-pune.pdf')
  assert.equal(p2pmdExportFileName('# Trip to Pune!\n\nDay one', 'slides'), 'trip-to-pune.slides.html')
  assert.equal(p2pmdExportFileName('', 'slides'), 'p2pmd-document.slides.html')
})

// A note's key lets whoever has it into the note, so a file name sent on or
// saved to a shared folder must never carry it.
test('an export is never named after the note key', () => {
  assert.equal(p2pmdExportFileName('', 'pdf'), 'p2pmd-document.pdf')
  assert.equal(p2pmdExportFileName('   \n\n', 'pdf'), 'p2pmd-document.pdf')
  assert.doesNotMatch(app, /p2pmdExportFileName\([^)]*p2pmdRoom\.key/)
})

test('the share button opens the sheet, and a name from the people panel is kept', () => {
  assert.match(app, /onPress=\{onP2pmdSharePress\}/)
  assert.match(app, /case P2PMD_SHARE_INFO_TYPE:\s+onP2pmdShareInfo\(parsed\)/)
  assert.match(app, /slides=\{p2pmdShareNote\?\.slides === true\}/)
  assert.match(app, /saveP2pmdPeerDisplayNameFromNote\(peerProfileName\)/)
  assert.match(app, /function saveP2pmdPeerDisplayNameFromNote [^{]+\{[\s\S]*?setP2pmdPeerDisplayName\(name\)/)
  // The page keeps the name it started with, or the new name would be new
  // html and load the note again.
  assert.match(app, /window\.__P2PMD_DISPLAY_NAME__=\$\{serializeInlineScriptValue\(p2pmdEditorDisplayName\)\}/)
  assert.match(app, /const p2pmdEditorDisplayName = useMemo\(\s+\(\) => p2pmdPeerDisplayName,\s+\[[^\]]*p2pmdEditorMount\]/)
})

// iOS does not open a share sheet over a modal that is still fading out, so
// Share invite did nothing there.
test('the sheet\'s actions wait for it to close on iOS', () => {
  assert.match(sheet, /visible=\{visible\}\s+onDismiss=\{onDismissed\}/)
  assert.doesNotMatch(sheet, /if \(!visible\) return null/)
  assert.match(app, /function afterP2pmdShareSheetCloses [^{]+\{\s+if \(Platform\.OS === 'ios'\) p2pmdShareSheetActionRef\.current = action/)
  assert.match(app, /onShareInvite=\{\(\) => afterP2pmdShareSheetCloses\(/)
  assert.match(app, /afterP2pmdShareSheetCloses\(\(\) => \{ void runP2pmdExport\(note, kind\) \}\)/)
  assert.match(app, /onDismissed=\{\(\) => \{\s+const action = p2pmdShareSheetActionRef\.current/)
})
