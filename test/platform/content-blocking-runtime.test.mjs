import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  createForcedUpdateCoordinator,
  initializeContentBlockingRuntime
} from '../../app/privacy/content-blocking-runtime.mjs'

const cachedState = { snapshotName: 'snapshot-1' }
const updatedState = { snapshotName: 'snapshot-2' }

describe('Content-blocking runtime', () => {
  test('enables cached rules before a refresh finishes', async () => {
    const events = []
    const refresh = deferred()
    const initialization = initializeContentBlockingRuntime({
      activateState: async () => {},
      blocker: { setEnabled: (enabled) => events.push(`enabled:${enabled}`) },
      discardState: async () => {},
      loadActiveState: async () => cachedState,
      loadNativeState: async (state) => events.push(`loaded:${state.snapshotName}`),
      updateState: async () => refresh.promise
    })

    await waitForMicrotasks()
    assert.deepEqual(events, ['enabled:false', 'loaded:snapshot-1', 'enabled:true'])

    refresh.resolve(cachedState)
    await initialization
  })

  test('activates an accepted update after loading it natively', async () => {
    const events = []

    await initializeContentBlockingRuntime({
      activateState: async (state) => events.push(`activated:${state.snapshotName}`),
      blocker: { setEnabled: (enabled) => events.push(`enabled:${enabled}`) },
      discardState: async () => {},
      loadActiveState: async () => null,
      loadNativeState: async (state) => events.push(`loaded:${state.snapshotName}`),
      updateState: async () => updatedState
    })

    assert.deepEqual(events, [
      'enabled:false',
      'loaded:snapshot-2',
      'activated:snapshot-2',
      'enabled:true'
    ])
  })

  test('discards a rejected update and restores cached rules', async () => {
    const events = []
    let loadCount = 0

    await initializeContentBlockingRuntime({
      activateState: async () => { throw new Error('state write failed') },
      blocker: { setEnabled: (enabled) => events.push(`enabled:${enabled}`) },
      discardState: async (state) => events.push(`discarded:${state.snapshotName}`),
      loadActiveState: async () => cachedState,
      loadNativeState: async (state) => {
        loadCount += 1
        events.push(`loaded:${state.snapshotName}:${loadCount}`)
      },
      updateState: async () => updatedState,
      warn: () => {}
    })

    assert.deepEqual(events, [
      'enabled:false',
      'loaded:snapshot-1:1',
      'enabled:true',
      'loaded:snapshot-2:2',
      'discarded:snapshot-2',
      'loaded:snapshot-1:3',
      'enabled:true'
    ])
  })

  test('forces a filter-list refresh when requested', async () => {
    const updateCalls = []

    await initializeContentBlockingRuntime({
      activateState: async () => {},
      blocker: { setEnabled: () => {} },
      discardState: async () => {},
      forceUpdate: true,
      loadActiveState: async () => cachedState,
      loadNativeState: async () => {},
      updateState: async (options) => {
        updateCalls.push(options)
        return cachedState
      }
    })

    assert.deepEqual(updateCalls, [{ force: true }])
  })

  test('reports a failed forced refresh while retaining cached rules', async () => {
    const events = []

    await assert.rejects(initializeContentBlockingRuntime({
      activateState: async () => {},
      blocker: { setEnabled: (enabled) => events.push(`enabled:${enabled}`) },
      discardState: async () => {},
      forceUpdate: true,
      loadActiveState: async () => cachedState,
      loadNativeState: async (state) => events.push(`loaded:${state.snapshotName}`),
      updateState: async () => { throw new Error('network unavailable') },
      warn: () => {}
    }), /network unavailable/)

    assert.deepEqual(events, ['enabled:false', 'loaded:snapshot-1', 'enabled:true'])
  })

  test('stays disabled when first-launch list download fails', async () => {
    const events = []

    await assert.rejects(initializeContentBlockingRuntime({
      activateState: async () => {},
      blocker: { setEnabled: (enabled) => events.push(`enabled:${enabled}`) },
      discardState: async () => {},
      loadActiveState: async () => null,
      loadNativeState: async () => {},
      updateState: async () => { throw new Error('offline') },
      warn: () => {}
    }), /offline/)

    assert.deepEqual(events, ['enabled:false'])
  })

  test('disables blocking if rejected rules and cached rules both fail to load', async () => {
    const events = []
    let loadCount = 0

    await assert.rejects(initializeContentBlockingRuntime({
      activateState: async () => { throw new Error('state write failed') },
      blocker: { setEnabled: (enabled) => events.push(`enabled:${enabled}`) },
      discardState: async () => {},
      loadActiveState: async () => cachedState,
      loadNativeState: async () => {
        loadCount += 1
        if (loadCount === 3) throw new Error('rollback failed')
      },
      updateState: async () => updatedState,
      warn: () => {}
    }), /state write failed/)

    assert.deepEqual(events, ['enabled:false', 'enabled:true', 'enabled:false'])
  })

  test('queues a forced refresh behind a non-forced refresh', async () => {
    const first = deferred()
    const calls = []
    const coordinate = createForcedUpdateCoordinator(({ force, now }) => {
      calls.push({ force, now })
      return calls.length === 1 ? first.promise : Promise.resolve(updatedState)
    }, () => 200)

    const normal = coordinate({ force: false, now: 100 })
    const forced = coordinate({ force: true, now: 101 })
    assert.deepEqual(calls, [{ force: false, now: 100 }])

    first.resolve(cachedState)
    assert.equal(await normal, cachedState)
    assert.equal(await forced, updatedState)
    assert.deepEqual(calls, [
      { force: false, now: 100 },
      { force: true, now: 200 }
    ])
  })

  test('runs a forced refresh after a failed non-forced refresh', async () => {
    const first = deferred()
    const calls = []
    const coordinate = createForcedUpdateCoordinator(({ force, now }) => {
      calls.push({ force, now })
      return calls.length === 1 ? first.promise : Promise.resolve(updatedState)
    }, () => 300)

    const normal = coordinate({ force: false, now: 100 })
    const forced = coordinate({ force: true, now: 101 })
    first.reject(new Error('network failed'))

    await assert.rejects(normal, /network failed/)
    assert.equal(await forced, updatedState)
    assert.deepEqual(calls, [
      { force: false, now: 100 },
      { force: true, now: 300 }
    ])
  })
})

function deferred () {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, reject, resolve }
}

async function waitForMicrotasks () {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
