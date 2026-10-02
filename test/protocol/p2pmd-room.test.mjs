import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const roomSource = await readFile(new URL('../../backend/p2pmd/room.mjs', import.meta.url), 'utf8')

describe('p2pmd room connection', () => {
  // The port a room's host advertises can belong to another app on this
  // phone. Taking it put the editor on that app's origin, PeerTunes' for one.
  it('joins on a port the system picks, not the one the host advertises', () => {
    assert.match(roomSource, /connectHolesail\(\{\s*key,\s*anyPort: true,/)
    assert.doesNotMatch(roomSource, /preferRemotePort/)
  })
})
