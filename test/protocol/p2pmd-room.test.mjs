import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { findNotePort, isUsableNotePort, rememberNotePort } from '../../backend/p2pmd/note-ports.mjs'
import { PEERTUNES_LOOPBACK_PORT } from '../../backend/peertunes/constants.mjs'

const roomSource = await readFile(new URL('../../backend/p2pmd/room.mjs', import.meta.url), 'utf8')
const serverSource = await readFile(new URL('../../backend/p2pmd/server.mjs', import.meta.url), 'utf8')
const sessionSource = await readFile(new URL('../../backend/holesail/session.mjs', import.meta.url), 'utf8')

const note = (letter) => `hs://s000${letter.repeat(52)}`

async function storage (t) {
  const path = await mkdtemp(join(tmpdir(), 'peersky-note-ports-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

describe('p2pmd room connection', () => {
  // The desktop keeps a note on one port, and a device joining it listens on
  // that port too. The phone picked a new one each time, so every device and
  // every restart showed a different address for the same note.
  it('joins on the port it used before, or the host\'s, as the desktop does', () => {
    assert.match(roomSource, /const preferred = await connectHolesail\(\{ key, port: saved, hostPort: true, udp, log \}\)/)
    assert.match(sessionSource, /: hostPort && \(port === undefined \|\| port === null\)\s+\? \{ ok: true, port: undefined \}/)
    assert.match(roomSource, /rememberNotePort\(roomKey, boundPort\)/)
  })

  // The port a host advertises can belong to another server in the app, and
  // a note on it put the editor on that server's origin: PeerTunes' for one.
  it('takes a port the system picks when that one is taken or is the app\'s own', () => {
    assert.match(roomSource, /if \(preferred\.ok && isUsableNotePort\(preferred\.info\?\.port\)\) return preferred\s+if \(preferred\.ok\) await stopHolesail\(\)\s+return connectHolesail\(\{ key, anyPort: true, udp, log \}\)/)
    assert.equal(isUsableNotePort(PEERTUNES_LOOPBACK_PORT), false)
    assert.equal(isUsableNotePort(80), false)
    assert.equal(isUsableNotePort(8989), true)
  })

  it('hosts a note on the port it was on before, and keeps it for next time', () => {
    assert.match(roomSource, /startP2pmdServer\(\{ preferredPort: connector \? findNotePort\(connector\) : null \}\)/)
    assert.match(roomSource, /rememberNotePort\(room\.key, room\.port\)/)
    // Taken by something else since: the system picks one rather than failing.
    assert.match(serverSource, /address = await listen\(instance, preferredPort \|\| 0\)\s+\} catch \(error\) \{\s+if \(!preferredPort\) throw error/)
  })
})

describe('ports kept for notes', () => {
  it('finds the port a note was on, and nothing for a note it never saw', async (t) => {
    const path = await storage(t)
    assert.equal(rememberNotePort(note('a'), 51234, path), true)
    assert.equal(findNotePort(note('a'), path), 51234)
    assert.equal(findNotePort(` ${note('a')} `, path), 51234)
    assert.equal(findNotePort(note('b'), path), null)
  })

  it('never keeps a reserved, low or malformed port, or a malformed key', async (t) => {
    const path = await storage(t)
    assert.equal(rememberNotePort(note('a'), PEERTUNES_LOOPBACK_PORT, path), false)
    assert.equal(rememberNotePort(note('a'), 443, path), false)
    assert.equal(rememberNotePort(note('a'), 70000, path), false)
    assert.equal(rememberNotePort('https://example.com', 51234, path), false)
    assert.equal(findNotePort(note('a'), path), null)
  })

  it('keeps the thirty used last, like the recent list', async (t) => {
    const path = await storage(t)
    const letters = 'abcdefghijklmnopqrstuvwxyz012345'.split('')
    for (const [index, letter] of letters.entries()) {
      rememberNotePort(note(letter), 50000 + index, path)
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    assert.equal(findNotePort(note('a'), path), null)
    assert.equal(findNotePort(note('5'), path), 50031)
    const stored = JSON.parse(await readFile(join(path, 'p2pmd-ports.json'), 'utf8'))
    assert.equal(Object.keys(stored.notes).length, 30)
  })
})
