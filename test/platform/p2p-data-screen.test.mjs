import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const screen = readFileSync(new URL('../../app/settings/P2PStorage.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const between = (start, end) => screen.slice(screen.indexOf(start), screen.indexOf(end))

// Settings, P2P Data opens with how much space P2P data takes, by part, as
// the desktop's P2P data does.
test('P2P Data opens with the space P2P data takes, in four parts', () => {
  const view = screen.slice(screen.indexOf('  return (\n    <>'))
  assert.ok(view.indexOf("title={t('Storage used')}") < view.indexOf("title={t('P2P sites')}"), 'first on the screen')
  assert.match(view, /\{summary \? formatBytes\(summary\.total \|\| 0\) : t\('Calculating\.\.\.'\)\}/)
  assert.match(view, /STORAGE_PARTS\.map\(\(part\) =>/)
  assert.match(view, /\{summary \? formatBytes\(summary\.parts\?\.\[part\.id\] \|\| 0\) : '-'\}/)
  const parts = between('const STORAGE_PARTS', 'export function P2PStorage')
  for (const id of ['hyper', 'hyperPrivate', 'deviceOnly', 'other']) assert.match(parts, new RegExp(`id: '${id}'`))
  // Sizes past a gigabyte read as GB.
  assert.match(screen, /return t\('\{size\} GB', \{ size: \(bytes \/ \(1024 \* 1024 \* 1024\)\)\.toFixed\(2\) \}\)/)
})

test('the numbers are read again after anything that frees space, never from an older answer', () => {
  const load = between('async function loadSummary ()', 'function confirmRemoveOffline')
  assert.match(load, /onCallRpc\(RPC_P2P_STORAGE_SUMMARY\)/)
  assert.match(load, /if \(sequence !== summaryRequestSequence\.current \|\| !mountedRef\.current\) return/)
  // After an offline copy is removed, an app's data deleted, or the cache cleared.
  assert.match(between('async function runOfflineAction', 'function confirmDeleteApp'), /if \(command === RPC_HYPER_OFFLINE_REMOVE\) void loadSummary\(\)/)
  assert.match(between('async function deleteApp', 'function confirmClearCache'), /void loadSummary\(\)/)
  assert.match(between('async function clearCache', 'function confirmClearAllData'), /void loadSummary\(\)/)
})

// The archive could only be cleared by app or source. Each entry has its own
// remove button now, which asks first: a tap meant for Copy beside it should
// not cost an entry.
test('each archive entry can be taken off the list on its own, after asking', () => {
  const row = between('archiveItems.map((item, index) => (', '{archiveTotalPages > 1 && (')
  assert.match(row, /accessibilityLabel=\{t\('Remove \{name\} from the list', \{ name: item\.name \}\)\}/)
  assert.match(row, /onPress=\{\(\) => confirmRemoveArchiveEntry\(item\)\}/)
  assert.match(row, /disabled=\{activeAction !== null\}/)

  const confirm = between('function confirmRemoveArchiveEntry', 'async function removeArchiveEntry')
  assert.match(confirm, /t\('Remove \{name\} from the list\?', \{ name: item\.name \}\)/)
  assert.match(confirm, /t\('Only this entry goes\. The drive and its files stay on this phone\.'\)/)
  assert.match(confirm, /\{ text: t\('Cancel'\), style: 'cancel' \}/)
  assert.match(confirm, /style: 'destructive', onPress: \(\) => void removeArchiveEntry\(item\)/)

  const remove = between('async function removeArchiveEntry', 'function copyArchiveUrl')
  assert.match(remove, /onCallRpc\(RPC_HYPER_ARCHIVE_REMOVE, \{ url: item\.url \}\)/)
  // The same page and filters, so the list does not jump back to the start.
  assert.match(remove, /loadPage\(archivePage, archiveSource, false, archiveQuery\)/)
  assert.match(remove, /if \(activeActionRef\.current\) return/)
})
