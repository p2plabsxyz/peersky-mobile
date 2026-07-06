import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  connectHolesail,
  getHolesailStatus,
  startHolesailLive,
  stopHolesail
} from '../../backend/holesail/session.mjs'

describe('holesail session validation', () => {
  afterEach(async () => {
    await stopHolesail()
  })

  it('starts with no active session', () => {
    assert.deepEqual(getHolesailStatus(), {
      ok: true,
      running: false,
      mode: null
    })
  })

  it('rejects invalid ports before creating a session', async () => {
    const result = await startHolesailLive({ port: 0 })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Invalid port. Expected an integer between 1 and 65535.')
    assert.equal(getHolesailStatus().running, false)
  })

  it('rejects non-loopback live hosts before creating a session', async () => {
    const result = await startHolesailLive({ host: '192.168.1.10' })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Host must be loopback (127.0.0.1, ::1, or localhost)')
    assert.equal(getHolesailStatus().running, false)
  })

  it('rejects unsafe bind hosts before creating a client proxy', async () => {
    const result = await connectHolesail({
      key: 'hs://abc123',
      host: '0.0.0.0'
    })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Host must be loopback (127.0.0.1, ::1, or localhost)')
    assert.equal(getHolesailStatus().running, false)
  })

  it('rejects malformed connection keys before creating a session', async () => {
    const result = await connectHolesail({ key: 'bad key with spaces' })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'Invalid holesail key. Use hs://... or an alphanumeric key.')
    assert.equal(getHolesailStatus().running, false)
  })
})
