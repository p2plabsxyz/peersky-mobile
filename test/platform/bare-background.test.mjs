import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import { BARE_BACKGROUND_GRACE_MS, resumeBareInBackground } from '../../app/bare-background.mjs'

function fakes (currentState = 'active') {
  const listeners = new Set()
  const timers = new Map()
  let next = 1
  const appState = {
    currentState,
    addEventListener (type, listener) {
      assert.equal(type, 'change')
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
    change (state) {
      this.currentState = state
      for (const listener of listeners) listener(state)
    }
  }
  const worklet = {
    suspended: false,
    terminated: false,
    resumed: 0,
    resume () {
      this.suspended = false
      this.resumed++
    }
  }
  const clock = {
    setTimer: (callback, ms) => {
      const id = next++
      timers.set(id, { callback, ms })
      return id
    },
    clearTimer: (id) => timers.delete(id),
    fire () {
      const due = [...timers.values()]
      timers.clear()
      for (const { callback } of due) callback()
    }
  }
  return { appState, worklet, clock, listeners, timers }
}

describe('Bare in the background on iOS', () => {
  test('resumes Bare before iOS would kill the app for holding on', () => {
    const { appState, worklet, clock, timers } = fakes()
    resumeBareInBackground(worklet, appState, clock)

    appState.change('inactive')
    assert.equal(timers.size, 0)
    appState.change('background')
    // What react-native-bare-kit does on its own listener.
    worklet.suspended = true

    assert.deepEqual([...timers.values()].map(({ ms }) => ms), [BARE_BACKGROUND_GRACE_MS])
    assert.ok(BARE_BACKGROUND_GRACE_MS < 25000, 'well inside the 30 seconds iOS gives')
    clock.fire()
    assert.equal(worklet.resumed, 1)
    assert.equal(worklet.suspended, false)
  })

  test('coming back before then leaves the resume to the library', () => {
    const { appState, worklet, clock, timers } = fakes()
    resumeBareInBackground(worklet, appState, clock)

    appState.change('background')
    worklet.suspended = true
    appState.change('active')
    worklet.suspended = false

    assert.equal(timers.size, 0)
    clock.fire()
    assert.equal(worklet.resumed, 0)
  })

  test('leaving again starts one new wait, not a second one', () => {
    const { appState, worklet, clock, timers } = fakes()
    resumeBareInBackground(worklet, appState, clock)

    appState.change('background')
    appState.change('inactive')
    appState.change('background')
    assert.equal(timers.size, 1)
  })

  test('does nothing once Bare is resumed or gone', () => {
    const { appState, worklet, clock } = fakes()
    resumeBareInBackground(worklet, appState, clock)

    appState.change('background')
    clock.fire()
    assert.equal(worklet.resumed, 0)

    appState.change('background')
    worklet.suspended = true
    worklet.terminated = true
    clock.fire()
    assert.equal(worklet.resumed, 0)
  })

  test('a backend started behind another app gets the same wait', () => {
    const { appState, worklet, clock } = fakes('background')
    worklet.suspended = true
    resumeBareInBackground(worklet, appState, clock)

    clock.fire()
    assert.equal(worklet.resumed, 1)
  })

  test('stopping removes the listener and the wait', () => {
    const { appState, worklet, clock, listeners, timers } = fakes()
    const stop = resumeBareInBackground(worklet, appState, clock)

    appState.change('background')
    stop()
    assert.equal(listeners.size, 0)
    assert.equal(timers.size, 0)
  })

  test('the app wires it for iOS and stops it with the worklet', async () => {
    const source = await readFile(new URL('../../app/backend.ts', import.meta.url), 'utf8')
    assert.match(source, /Platform\.OS === 'ios'\) stopBareBackground = resumeBareInBackground\(next, AppState\)/)
    assert.match(source, /stopBareBackground\?\.\(\)[\s\S]{0,200}current\?\.terminate\(\)/)
  })
})
