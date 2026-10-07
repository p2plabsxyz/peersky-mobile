import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { getP2pmdSyncDisplay } from '../../app/p2pmd-sync-status.mjs'

// Every keystroke used to flash Unsaved changes, Syncing... and Saved.
test('unsaved work is a dot and a saved note says nothing', () => {
  assert.deepEqual(getP2pmdSyncDisplay('Unsaved changes'), { kind: 'dot' })
  assert.deepEqual(getP2pmdSyncDisplay('Syncing...'), { kind: 'dot' })
  for (const quiet of ['Saved', 'Loaded', 'Remote update', 'Ready', 'Image uploaded', '', null]) {
    assert.deepEqual(getP2pmdSyncDisplay(quiet), { kind: 'none' }, String(quiet))
  }
})

test('errors and publishing are still spelled out', () => {
  for (const text of ['Error: Room request failed', 'Sync error', 'Publishing to Hyper...', 'Publish failed: offline', 'Published to Hyper', 'Joining room page...']) {
    assert.deepEqual(getP2pmdSyncDisplay(text), { kind: 'text', text })
  }
})

test('the dot sits at the end of the key row', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  assert.match(app, /\{p2pmdRoom\.key\}\s+<\/Text>\s+\{p2pmdSyncDisplay\.kind === 'dot' && \(\s+<View accessible accessibilityLabel='Unsaved changes' style=\{styles\.p2pmdUnsavedDot\} \/>/)
  assert.doesNotMatch(app, /\{p2pmdSyncStatus\}/)
})
