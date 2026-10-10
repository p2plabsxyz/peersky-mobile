import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  describeLinkedDevice,
  isMeteredNetwork,
  labelLinkedDevices,
  sortLinkedDevices
} from '../../app/linked-devices.mjs'

describe('linked devices', () => {
  test('a device is named by what it is, and numbered only when there are two', () => {
    const one = labelLinkedDevices([{ id: 'a', type: 'desktop', firstSeen: 5 }])
    assert.equal(one.get('a'), 'Desktop')

    const labels = labelLinkedDevices([
      { id: 'late', type: 'desktop', firstSeen: 20 },
      { id: 'early', type: 'desktop', firstSeen: 10 },
      { id: 'phone', type: 'phone', firstSeen: 30 },
      { id: 'odd', type: 'tablet', firstSeen: 1 }
    ])
    assert.equal(labels.get('early'), 'Desktop 1')
    assert.equal(labels.get('late'), 'Desktop 2')
    assert.equal(labels.get('phone'), 'Phone')
    assert.equal(labels.has('odd'), false)
  })

  test('online devices come first, then the one seen last', () => {
    const sorted = sortLinkedDevices([
      { id: 'old', online: false, lastSeen: 1 },
      { id: 'recent', online: false, lastSeen: 9 },
      { id: 'live', online: true, lastSeen: 0 }
    ])
    assert.deepEqual(sorted.map((device) => device.id), ['live', 'recent', 'old'])
  })

  test('when a device was last there, in plain words', () => {
    const now = Date.UTC(2026, 9, 10, 12)
    assert.equal(describeLinkedDevice({ online: true, lastSeen: 0 }, now), 'Online now')
    assert.equal(describeLinkedDevice({ online: false, lastSeen: 0 }, now), 'Not connected yet')
    assert.equal(describeLinkedDevice({ online: false, lastSeen: now - 20 * 1000 }, now), 'Seen just now')
    assert.equal(describeLinkedDevice({ online: false, lastSeen: now - 5 * 60 * 1000 }, now), 'Seen 5 min ago')
    assert.equal(describeLinkedDevice({ online: false, lastSeen: now - 60 * 60 * 1000 }, now), 'Seen 1 hour ago')
    assert.equal(describeLinkedDevice({ online: false, lastSeen: now - 3 * 60 * 60 * 1000 }, now), 'Seen 3 hours ago')
    assert.equal(describeLinkedDevice({ online: false, lastSeen: now - 24 * 60 * 60 * 1000 }, now), 'Seen 1 day ago')
    assert.match(describeLinkedDevice({ online: false, lastSeen: now - 40 * 24 * 60 * 60 * 1000 }, now), /^Seen on /)
  })

  test('only a cellular connection counts as metered', () => {
    assert.equal(isMeteredNetwork({ type: 'CELLULAR' }), true)
    assert.equal(isMeteredNetwork({ type: 'WIFI' }), false)
    assert.equal(isMeteredNetwork({ type: 'UNKNOWN' }), false)
    assert.equal(isMeteredNetwork(undefined), false)
  })
})
