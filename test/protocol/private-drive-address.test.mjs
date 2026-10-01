import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import b4a from 'b4a'

const hex = (bytes) => b4a.toString(bytes, 'hex')

describe('this phone knows its own private drives by address', () => {
  // Found running on a simulator: the phone kept drive.id, the z32 form,
  // where every lookup compares hex. It never matched a link to its own
  // private or device-only drive, so those opened through the public store,
  // and it never saved its private drive's id, so the desktop was never told
  // about it.
  it('matches either form of a link, and hands out keyed drives only for its own', async () => {
    const runtime = await import('../../backend/hyper/runtime.mjs')
    const { default: z32 } = await import('z32')
    const privateKey = b4a.alloc(32, 7)
    const deviceKey = b4a.alloc(32, 9)

    runtime.rememberSyncedPrivateHyperdrive({ id: z32.encode(privateKey), key: privateKey })
    runtime.rememberDeviceOnlyHyperdrive({ id: z32.encode(deviceKey), key: deviceKey })

    assert.equal(runtime.isSyncedPrivateHyperdriveAddress(`hyper://${z32.encode(privateKey)}/note.txt`), true)
    assert.equal(runtime.isSyncedPrivateHyperdriveAddress(`hyper://${hex(privateKey)}/`), true)
    assert.equal(runtime.isDeviceOnlyHyperdriveAddress(`hyper://${z32.encode(deviceKey)}/clip.mp4`), true)
    assert.equal(runtime.isSyncedPrivateHyperdriveAddress(`hyper://${z32.encode(deviceKey)}/`), false)

    assert.equal(await runtime.getKeyedPrivateHyperdrive(`hyper://${'b'.repeat(52)}/`), null)
    assert.equal(await runtime.getKeyedPrivateHyperdrive('not a drive'), null)
  })
})
