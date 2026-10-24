// A note on the person's phone and desktop both is joined on the other device
// when it has the note open, and hosted from this phone's copy only when
// nobody answers. Two hosts for one note never see each other's edits, and an
// empty note must never go up in place of the real one. room.mjs needs Bare
// addons, so these read the source rather than run it.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

function between (source, start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, `missing ${start}`)
  const to = source.indexOf(end, from + start.length)
  assert.notEqual(to, -1, `missing ${end}`)
  return source.slice(from, to)
}

describe('opening a note that is on another device too', () => {
  it('looks for it there first, and reports nobody rather than joining an empty room', async () => {
    const source = await read('backend/p2pmd/room.mjs')
    const join = between(source, 'export async function joinP2pmdRoom', 'export function getP2pmdRoomStatus')
    assert.match(join, /waitForJoinedRoomReady\(boundPort, token, probe \? SHARED_NOTE_LOOK_MS : HOST_LOOK_MS\)/)
    assert.match(join, /\} catch \{\s*await stopHolesail\(\)\s*return \{ ok: false, noHost: true/)
  })

  // A join with nobody hosting waited up to 40 seconds and then opened an
  // empty note, and what was typed there was gone once the host came back.
  it('says nobody has a note open instead of joining an empty room', async () => {
    const source = await read('backend/p2pmd/room.mjs')
    assert.match(source, /const HOST_LOOK_MS = 15000/)
    const join = between(source, 'export async function joinP2pmdRoom', 'export function getP2pmdRoomStatus')
    assert.doesNotMatch(join, /warning/)

    const app = await read('app/index.tsx')
    const onJoin = between(app, 'async function onP2pmdRoomJoin', 'async function onP2pmdSharedNoteOpen')
    assert.match(onJoin, /const message = response\.noHost\s*\? t\('Nobody has this note open right now\. Try again when its host opens it\.'\)/)
    // The wait shows on the button instead of a greyed-out screen.
    assert.match(onJoin, /setIsP2pmdJoining\(true\)/)
    assert.match(onJoin, /\} finally \{\s*setIsLoading\(false\)\s*setIsP2pmdJoining\(false\)/)
    assert.match(app, /\{isP2pmdJoining \? t\('Looking for the host\.\.\.'\) : t\('Join Note'\)\}/)
  })

  it('shows a guest that the host is away while the note is read only', async () => {
    const app = await read('app/index.tsx')
    assert.match(app, /case 'p2pmd-host-away':\s*setP2pmdHostAway\(parsed\.away === true\)/)
    assert.match(app, /\{p2pmdHostAway && p2pmdRoom\.role !== 'host' && !isP2pmdLandscapeSlides && \(/)
    assert.match(app, /t\('The host is away\. You can read the note, and editing comes back when they return\.'\)/)
    // A new editor page starts out knowing nothing of the host.
    assert.match(app, /useEffect\(\(\) => \{\s*setP2pmdHostAway\(false\)\s*\}, \[p2pmdRoom\?\.key, p2pmdRoom\?\.role, p2pmdUrl, p2pmdEditorMount\]\)/)
  })

  it('hosts it only from a copy on this phone', async () => {
    const source = await read('backend/p2pmd/room.mjs')
    const create = between(source, 'export async function createP2pmdRoom', 'export async function joinP2pmdRoom')
    // Checked before anything starts, so no server goes up without a copy.
    assert.ok(create.indexOf('requireCopy') < create.indexOf('startP2pmdServer'))
    assert.match(create, /\} else if \(requireCopy\) \{\s*return \{\s*ok: false/)
  })

  it('hosts the copy only when nobody answered', async () => {
    const source = await read('app/index.tsx')
    const open = between(source, 'async function onP2pmdSharedNoteOpen', 'function rememberP2pmdRoom')
    assert.match(open, /callRpc\(RPC_P2PMD_ROOM_JOIN, \{ key: roomKey, udp: false, probe: true \}\)/)
    assert.match(open, /if \(response\.noHost\) \{\s*hostCopy = true/)
    assert.match(open, /if \(hostCopy\) await onP2pmdRoomCreate\(roomKey, \{ requireCopy: true \}\)/)

    const list = between(source, "onPress={() => void (room.role !== 'host'", ')}')
    assert.match(list, /room\.shared\s*\? onP2pmdSharedNoteOpen\(room\.key\)/)
  })

  it('gives the screen a desktop\'s P2PMD name, not just the file, so it does not ask again', async () => {
    const source = await read('app/index.tsx')
    const intake = between(source, 'async function takeNotesFromDevice', 'void takeNotesFromDevice()')
    assert.match(intake, /saveP2pmdPeerDisplayName\(response\.name\)/)
    assert.match(intake, /setP2pmdPeerDisplayName\(name\)/)
  })

  it('marks notes shared once they went to a desktop with their text', async () => {
    const source = await read('app/settings/LinkDevice.tsx')
    assert.match(source, /if \(toDesktop\) emitP2pmdNotesShared\(response\.sharedNotes\)/)
  })
})
