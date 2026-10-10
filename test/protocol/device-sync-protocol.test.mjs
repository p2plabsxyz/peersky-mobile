import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  checkDeviceSyncProof,
  deviceSyncProof,
  deviceSyncTopic,
  helloFrame,
  MAX_ANNOUNCED_DRIVES,
  MAX_DEVICE_SYNC_FRAME_BYTES,
  parseDeviceSyncFrame,
  proofFrame
} from '../../backend/hyper/device-sync-protocol.mjs'

const KEY = '0f'.repeat(32)
const HANDSHAKE = '0e'.repeat(64)
const SENDER = '0d'.repeat(32)
const OTHER = '0c'.repeat(32)
const DRIVE = 'aa'.repeat(32)

describe('device sync protocol', () => {
  // PeerSky Desktop pins the same values in test/p2p/device-sync-protocol.test.js.
  test('the topic and the proof match the desktop byte for byte', () => {
    assert.equal(deviceSyncTopic(KEY).toString('hex'), 'e702b30ef6aaa58eb3694a8888c6ddeda12383813d5121dec0db65df9b9c3cc8')
    assert.equal(deviceSyncProof(KEY, HANDSHAKE, SENDER), '8beb43aaede8fa35e6b0558e88ebeae7c1b3e809c00a68ec98e698fdae438c6c')
    assert.equal(deviceSyncTopic(Buffer.from(KEY, 'hex')).toString('hex'), deviceSyncTopic(KEY).toString('hex'))
  })

  test('the topic is not the key, and another key meets elsewhere', () => {
    assert.notEqual(deviceSyncTopic(KEY).toString('hex'), KEY)
    assert.notEqual(deviceSyncTopic('01'.repeat(32)).toString('hex'), deviceSyncTopic(KEY).toString('hex'))
    assert.equal(deviceSyncTopic('short'), null)
    assert.equal(deviceSyncTopic(null), null)
  })

  test('a proof holds for its key, its connection and its sender only', () => {
    const proof = deviceSyncProof(KEY, HANDSHAKE, SENDER)
    assert.equal(checkDeviceSyncProof(KEY, HANDSHAKE, SENDER, proof), true)
    // Someone with another key.
    assert.equal(checkDeviceSyncProof('01'.repeat(32), HANDSHAKE, SENDER, proof), false)
    // Replayed on another connection.
    assert.equal(checkDeviceSyncProof(KEY, '0b'.repeat(64), SENDER, proof), false)
    // Bounced back at its sender, who checks it against the other side's key.
    assert.equal(checkDeviceSyncProof(KEY, HANDSHAKE, OTHER, proof), false)
    assert.equal(checkDeviceSyncProof(KEY, HANDSHAKE, SENDER, 'nope'), false)
    assert.equal(checkDeviceSyncProof(KEY, HANDSHAKE, SENDER, proof.toUpperCase()), false)
  })

  test('frames are checked before anything reads them', () => {
    const proof = deviceSyncProof(KEY, HANDSHAKE, SENDER)
    assert.deepEqual(parseDeviceSyncFrame(proofFrame(proof)), { t: 'proof', proof })
    assert.equal(parseDeviceSyncFrame('{"t":"proof","proof":"zz"}'), null)
    assert.equal(parseDeviceSyncFrame('not json'), null)
    assert.equal(parseDeviceSyncFrame('[]'), null)
    assert.equal(parseDeviceSyncFrame('{"t":"other"}'), null)
    assert.equal(parseDeviceSyncFrame('x'.repeat(MAX_DEVICE_SYNC_FRAME_BYTES + 1)), null)
  })

  test('a hello says the device type, the drives and whether the phone is on cellular', () => {
    const text = helloFrame({ device: 'phone', drives: [{ id: DRIVE }, { id: 'bb'.repeat(32), key: 'cc'.repeat(32) }], metered: true })
    assert.deepEqual(parseDeviceSyncFrame(text), {
      t: 'hello',
      device: 'phone',
      drives: [{ id: DRIVE }, { id: 'bb'.repeat(32), key: 'cc'.repeat(32) }],
      metered: true
    })
    assert.equal(parseDeviceSyncFrame(helloFrame({ device: 'desktop', drives: [] })).metered, false)
    assert.throws(() => helloFrame({ device: 'tablet' }))
  })

  test('a hello drops repeats, bad entries and anything past the limit', () => {
    const many = Array.from({ length: MAX_ANNOUNCED_DRIVES + 20 }, (_, index) => ({ id: index.toString(16).padStart(64, '0') }))
    const built = parseDeviceSyncFrame(helloFrame({ device: 'desktop', drives: [{ id: DRIVE }, { id: DRIVE }, { id: 'bad' }, ...many] }))
    assert.equal(built.drives.length, MAX_ANNOUNCED_DRIVES)
    assert.equal(built.drives[0].id, DRIVE)
    assert.equal(built.drives.filter((drive) => drive.id === DRIVE).length, 1)

    // Received ones are refused whole when anything in them is off.
    assert.equal(parseDeviceSyncFrame(JSON.stringify({ t: 'hello', device: 'phone', drives: [{ id: 'bad' }] })), null)
    assert.equal(parseDeviceSyncFrame(JSON.stringify({ t: 'hello', device: 'phone', drives: [{ id: DRIVE, key: 5 }] })), null)
    assert.equal(parseDeviceSyncFrame(JSON.stringify({ t: 'hello', device: 'robot', drives: [] })), null)
    assert.equal(parseDeviceSyncFrame(JSON.stringify({ t: 'hello', device: 'phone', drives: many })), null)
    assert.deepEqual(parseDeviceSyncFrame(JSON.stringify({ t: 'hello', device: 'phone', drives: [{ id: DRIVE }, { id: DRIVE }] })).drives, [{ id: DRIVE }])
  })
})
