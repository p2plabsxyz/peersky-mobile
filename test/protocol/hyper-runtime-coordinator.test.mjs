import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntimeCoordinator } from '../../backend/hyper/runtime-coordinator.mjs'

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
