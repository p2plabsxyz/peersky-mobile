import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  closeRuntimeCandidates,
  createRuntimeCoordinator,
  initializeRuntimeCandidate
} from '../../backend/hyper/runtime-coordinator.mjs'

test('runtime maintenance waits for active work and blocks new operations', async () => {
  const coordinator = createRuntimeCoordinator()
  const events = []
  let releaseFirst
  let releaseMaintenance

  const first = coordinator.runOperation(async () => {
    events.push('first-start')
    await new Promise((resolve) => { releaseFirst = resolve })
    events.push('first-end')
  })
  await Promise.resolve()

  const maintenance = coordinator.runMaintenance(async () => {
    events.push('maintenance-start')
    await new Promise((resolve) => { releaseMaintenance = resolve })
    events.push('maintenance-end')
  })
  const second = coordinator.runOperation(async () => {
    events.push('second')
  })

  await Promise.resolve()
  assert.deepEqual(events, ['first-start'])
  releaseFirst()
  await first
  await Promise.resolve()
  assert.deepEqual(events, ['first-start', 'first-end', 'maintenance-start'])
  releaseMaintenance()
  await Promise.all([maintenance, second])
  assert.deepEqual(events, [
    'first-start',
    'first-end',
    'maintenance-start',
    'maintenance-end',
    'second'
  ])
})

test('runtime shutdown closes fulfilled runtimes when another opening fails', async () => {
  let closed = 0
  const runtime = { close: async () => { closed += 1 } }

  await assert.rejects(closeRuntimeCandidates([
    Promise.reject(new Error('opening failed')),
    Promise.resolve(runtime),
    runtime
  ]), /opening failed/)

  assert.equal(closed, 1)
})

test('runtime shutdown attempts every close before reporting failure', async () => {
  const events = []

  await assert.rejects(closeRuntimeCandidates([
    { close: async () => { events.push('first'); throw new Error('close failed') } },
    { close: async () => { events.push('second') } }
  ]), /close failed/)

  assert.deepEqual(events, ['first', 'second'])
})

test('failed runtime configuration closes the partially opened runtime', async () => {
  let closed = 0
  const runtime = { close: async () => { closed += 1 } }

  await assert.rejects(initializeRuntimeCandidate(
    async () => runtime,
    async () => { throw new Error('configuration failed') }
  ), /configuration failed/)

  assert.equal(closed, 1)
})
