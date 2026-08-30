import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createPrivateHyperRuntimeOptions,
  matchesHyperdriveAddress
} from '../../backend/hyper/runtime-routing.mjs'

test('private Hyper runtime disables discovery and replication', () => {
  assert.deepEqual(createPrivateHyperRuntimeOptions('/data/hyper-sdk-private'), {
    storage: '/data/hyper-sdk-private',
    autoJoin: false,
    doReplicate: false
  })
})

test('routes only the matching private drive address to isolated storage', () => {
  const driveId = 'a'.repeat(64)

  assert.equal(matchesHyperdriveAddress(`hyper://${driveId}/private.txt`, driveId), true)
  assert.equal(matchesHyperdriveAddress(`hyper://${'b'.repeat(64)}/private.txt`, driveId), false)
  assert.equal(matchesHyperdriveAddress('https://example.com/', driveId), false)
  assert.equal(matchesHyperdriveAddress('not a url', driveId), false)
})
