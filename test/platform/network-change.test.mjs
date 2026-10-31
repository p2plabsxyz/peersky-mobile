import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { networkSignature, shouldRefreshForNetwork } from '../../app/network-change.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('a network is its kind and the phone\'s address on it', () => {
  assert.equal(networkSignature({ type: 'WIFI', isConnected: true }, '192.168.1.20'), 'WIFI|192.168.1.20')
  assert.equal(networkSignature({ type: 'CELLULAR', isConnected: true }, '10.42.0.7'), 'CELLULAR|10.42.0.7')
  assert.equal(networkSignature({ type: 'WIFI', isConnected: true }, '0.0.0.0'), 'WIFI|')
  assert.equal(networkSignature({ type: 'NONE', isConnected: false }, '192.168.1.20'), 'offline')
  assert.equal(networkSignature(null, ''), 'offline')
})

test('the swarm is refreshed on a new network, a new address, or coming back online', () => {
  const wifi = networkSignature({ type: 'WIFI', isConnected: true }, '192.168.1.20')
  const renewed = networkSignature({ type: 'WIFI', isConnected: true }, '192.168.1.57')
  const mobile = networkSignature({ type: 'CELLULAR', isConnected: true }, '10.42.0.7')

  // The first look is only where things stand.
  assert.equal(shouldRefreshForNetwork(null, wifi), false)
  assert.equal(shouldRefreshForNetwork(wifi, wifi), false)
  // Wi-Fi to mobile data, and a router handing out a new address overnight.
  assert.equal(shouldRefreshForNetwork(wifi, mobile), true)
  assert.equal(shouldRefreshForNetwork(wifi, renewed), true)
  // Nothing to announce while offline; back online it is announced again.
  assert.equal(shouldRefreshForNetwork(wifi, 'offline'), false)
  assert.equal(shouldRefreshForNetwork('offline', wifi), true)
})

test('the app listens for network changes and looks again on the background tick', async () => {
  const watch = await read('app/hyper-network-refresh.ts')
  assert.match(watch, /Network\.addNetworkStateListener\(\(\) => \{ void check\(\) \}\)/)
  assert.match(watch, /addPeerChatBackgroundTickListener\(\(\) => \{ void check\(\) \}\)/)
  assert.match(watch, /Network\.getIpAddressAsync\(\)/)
  assert.match(watch, /if \(shouldRefreshForNetwork\(last, next\)\) \{\s*void refresh\(\)/)
  // Both are let go when it stops.
  assert.match(watch, /networkSubscription\.remove\(\)/)
  assert.match(watch, /tickSubscription\.remove\(\)/)

  // Started with the backend, so it runs with the screen or without it, as
  // when Android's PeerChat service started the backend on its own.
  const backend = await read('app/backend.ts')
  assert.match(backend, /if \(!stopNetworkWatch\) stopNetworkWatch = watchHyperNetwork\(\(\) => callBackend\(RPC_HYPER_REFRESH, \{\}\)\)/)
  assert.match(backend, /stopNetworkWatch\?\.\(\)/)
  const app = await read('app/index.tsx')
  assert.doesNotMatch(app, /useHyperNetworkRefresh/)
})
