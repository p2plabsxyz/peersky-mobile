import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const screen = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
const workspace = screen.slice(
  screen.indexOf("activeTab === 'p2pmd' && p2pmdWorkspaceReady"),
  screen.indexOf('<WebView', screen.indexOf("activeTab === 'p2pmd' && p2pmdWorkspaceReady"))
)
const header = workspace.slice(workspace.indexOf('styles.p2pmdWorkspaceHeader'), workspace.indexOf('styles.p2pmdWorkspaceMeta'))
const meta = workspace.slice(workspace.indexOf('styles.p2pmdWorkspaceMeta'))

// A note fills the screen, so the way to another tab was the menu, New tab,
// and then the tab list. The tabs sit in the header as on the toolbar.
test('an open note has the tabs button beside its menu', () => {
  assert.match(header, /accessibilityLabel=\{tp\(\{ one: 'Open tabs, \{count\} open', other: 'Open tabs, \{count\} open' \}, browserTabsState\.tabs\.length\)\}/)
  assert.match(header, /onPress=\{\(\) => \{\s+browserUserInteractedRef\.current = true\s+setBrowserTabsVisible\(true\)/)
  assert.ok(header.indexOf('Open tabs') < header.indexOf('<BrowserOverflowMenu'))
  // The tab list is drawn under the note, which steps aside while it is open.
  assert.match(screen, /if \(!browserOverlay && !browserTabsVisible && activeTab === 'p2pmd' && p2pmdWorkspaceReady/)
})

test('the host or client tag sits beside the local address, leaving the header room', () => {
  assert.doesNotMatch(header, /\{p2pmdRoom\.role\b/)
  const urlRow = meta.slice(meta.indexOf('styles.p2pmdWorkspaceUrlRow'))
  const tag = urlRow.indexOf("{p2pmdRoom.role === 'host' ? t('host') : t('client')}")
  assert.ok(tag > 0 && urlRow.indexOf('{p2pmdRoom.localUrl}') < tag)
  assert.match(urlRow, /styles\.p2pmdWorkspaceRoleInline/)
})
