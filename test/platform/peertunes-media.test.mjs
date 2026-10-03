import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { isAppInBrowserTabs } from '../../app/browser-tabs.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// PeerTunes plays from a player kept out of sight, so switching tabs does not
// stop it. It was kept for the whole session, and closing its tab or burning
// every tab left the music playing with nothing to stop it.
test('closing PeerTunes stops the music', async () => {
  const tab = (id, sources) => ({ id, history: sources.map((source) => ({ source })) })
  const state = {
    tabs: [
      tab('a', [{ kind: 'home' }, { kind: 'app', app: 'peertunes' }]),
      tab('b', [{ kind: 'web', uri: 'https://example.com/' }])
    ]
  }
  assert.equal(isAppInBrowserTabs(state, 'peertunes'), true)
  assert.equal(isAppInBrowserTabs({ tabs: [state.tabs[1]] }, 'peertunes'), false)
  assert.equal(isAppInBrowserTabs({ tabs: [] }, 'peertunes'), false)

  const app = await read('app/index.tsx')
  assert.match(app, /if \(peertunesMounted && !isAppInBrowserTabs\(browserTabsState, 'peertunes'\)\) setPeertunesMounted\(false\)/)
})
