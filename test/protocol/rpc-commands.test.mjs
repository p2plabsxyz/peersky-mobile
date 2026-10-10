import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT,
  RPC_HYPER_LIBRARY_LIST,
  RPC_HYPER_LIBRARY_UPLOAD,
  RPC_HYPER_LAN_STATUS,
  RPC_HYPER_OFFLINE_KEEP,
  RPC_HYPER_OFFLINE_LIST,
  RPC_HYPER_OFFLINE_PAUSE,
  RPC_HYPER_OFFLINE_REMOVE,
  RPC_HYPER_OFFLINE_RESUME,
  RPC_HYPER_OFFLINE_RESUME_ALL,
  RPC_HYPER_REFRESH,
  RPC_HYPER_STORAGE_CLEAR_ALL,
  RPC_HYPER_STORAGE_CLEAR_CACHE,
  RPC_HYPER_STORAGE_DELETE_APP,
  RPC_HYPER_STORAGE_LIST,
  RPC_PEERCHAT_INIT,
  RPC_PEERCHAT_ATTACHMENT_OPEN,
  RPC_PEERCHAT_ATTACHMENT_UPLOAD,
  RPC_PEERCHAT_DM_ACCEPT,
  RPC_PEERCHAT_DM_CREATE,
  RPC_PEERCHAT_DM_REJECT,
  RPC_PEERCHAT_PROFILE_SET,
  RPC_PEERCHAT_ROOM_CREATE,
  RPC_PEERCHAT_ROOM_JOIN,
  RPC_PEERCHAT_ROOMS,
  RPC_PEERCHAT_SNAPSHOT,
  RPC_PEERCHAT_SEND,
  RPC_PEERCHAT_ROOM_LEAVE,
  RPC_PEERCHAT_REACT,
  RPC_PEERCHAT_SET_ACTIVE,
  RPC_PEERCHAT_ROOM_PIN,
  RPC_PEERCHAT_ROOM_MUTE,
  RPC_PEERCHAT_ROOM_UPDATE,
  RPC_PEERCHAT_ONBOARD,
  RPC_PEERCHAT_BLOCK,
  RPC_PEERCHAT_UNBLOCK
} from '../../backend/rpc/commands.mjs'

test('Hyper storage and LAN discovery use distinct RPC command IDs', () => {
  const commands = [
    RPC_HYPER_INIT,
    RPC_HYPER_FETCH,
    RPC_HYPER_STORAGE_LIST,
    RPC_HYPER_STORAGE_DELETE_APP,
    RPC_HYPER_STORAGE_CLEAR_CACHE,
    RPC_HYPER_LIBRARY_LIST,
    RPC_HYPER_LIBRARY_UPLOAD,
    RPC_HYPER_LAN_STATUS,
    RPC_HYPER_STORAGE_CLEAR_ALL,
    RPC_HYPER_REFRESH,
    RPC_HYPER_OFFLINE_LIST,
    RPC_HYPER_OFFLINE_KEEP,
    RPC_HYPER_OFFLINE_PAUSE,
    RPC_HYPER_OFFLINE_RESUME,
    RPC_HYPER_OFFLINE_RESUME_ALL,
    RPC_HYPER_OFFLINE_REMOVE
  ]

  assert.deepEqual(commands, [1, 2, 4, 5, 6, 7, 8, 9, 14, 15, 60, 61, 62, 63, 64, 65])
  assert.equal(new Set(commands).size, commands.length)
})

test('Hyper offline RPC commands route to the offline manager', async () => {
  const router = await readFile(
    new URL('../../backend/rpc/router.mjs', import.meta.url),
    'utf8'
  )

  const routes = [
    [RPC_HYPER_OFFLINE_LIST, 'RPC_HYPER_OFFLINE_LIST', 'listHyperOffline'],
    [RPC_HYPER_OFFLINE_KEEP, 'RPC_HYPER_OFFLINE_KEEP', 'keepHyperOffline'],
    [RPC_HYPER_OFFLINE_PAUSE, 'RPC_HYPER_OFFLINE_PAUSE', 'pauseHyperOffline'],
    [RPC_HYPER_OFFLINE_RESUME, 'RPC_HYPER_OFFLINE_RESUME', 'resumeHyperOffline'],
    [RPC_HYPER_OFFLINE_RESUME_ALL, 'RPC_HYPER_OFFLINE_RESUME_ALL', 'resumeWantedHyperOffline'],
    [RPC_HYPER_OFFLINE_REMOVE, 'RPC_HYPER_OFFLINE_REMOVE', 'removeHyperOffline']
  ]

  for (const [command, commandName, handlerName] of routes) {
    assert.equal(Number.isSafeInteger(command), true)
    assert.match(router, new RegExp(`req[.]command === ${commandName}`))
    assert.match(router, new RegExp(`await ${handlerName}[(]parseJsonMessage[(]req[.]data[)][)]`))
  }
})

test('Hyper initialization resumes wanted offline downloads in the background', async () => {
  const router = await readFile(
    new URL('../../backend/rpc/router.mjs', import.meta.url),
    'utf8'
  )
  const initRoute = router.slice(
    router.indexOf('req.command === RPC_HYPER_INIT'),
    router.indexOf('req.command === RPC_HYPER_FETCH')
  )

  assert.match(initRoute, /replyJson[(]req,[\s\S]*if [(]options[.]allowNetwork !== false[)]/)
  assert.match(initRoute, /resumeWantedHyperOffline[(][)][.]catch/)
})

test('PeerChat RPC commands use a dedicated command range', () => {
  const commands = [
    RPC_PEERCHAT_INIT,
    RPC_PEERCHAT_PROFILE_SET,
    RPC_PEERCHAT_ROOM_CREATE,
    RPC_PEERCHAT_ROOM_JOIN,
    RPC_PEERCHAT_ROOMS,
    RPC_PEERCHAT_SNAPSHOT,
    RPC_PEERCHAT_SEND,
    RPC_PEERCHAT_ROOM_LEAVE,
    RPC_PEERCHAT_REACT,
    RPC_PEERCHAT_SET_ACTIVE,
    RPC_PEERCHAT_ROOM_PIN,
    RPC_PEERCHAT_ROOM_MUTE,
    RPC_PEERCHAT_ROOM_UPDATE,
    RPC_PEERCHAT_DM_CREATE,
    RPC_PEERCHAT_DM_ACCEPT,
    RPC_PEERCHAT_DM_REJECT,
    RPC_PEERCHAT_ONBOARD,
    RPC_PEERCHAT_ATTACHMENT_UPLOAD,
    RPC_PEERCHAT_ATTACHMENT_OPEN
  ]

  assert.deepEqual(commands, [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58])
  assert.equal(new Set(commands).size, commands.length)
})

test('PeerChat blocking RPC commands route to the service and stay clear of the hyper range', async () => {
  const commands = [RPC_PEERCHAT_BLOCK, RPC_PEERCHAT_UNBLOCK]
  assert.deepEqual(commands, [66, 67])
  assert.equal(new Set([...commands, RPC_HYPER_OFFLINE_LIST, RPC_HYPER_OFFLINE_REMOVE]).size, 4)

  const router = await readFile(
    new URL('../../backend/rpc/router.mjs', import.meta.url),
    'utf8'
  )
  assert.match(router, /req[.]command === RPC_PEERCHAT_BLOCK/)
  assert.match(router, /peerChat[.]blockPeer[(]parseJsonMessage[(]req[.]data[)][)]/)
  assert.match(router, /req[.]command === RPC_PEERCHAT_UNBLOCK/)
  assert.match(router, /peerChat[.]unblockPeer[(]parseJsonMessage[(]req[.]data[)][)]/)

  // The screen seeds its blocked list from these two, so both must carry it.
  const initRoute = router.slice(
    router.indexOf('req.command === RPC_PEERCHAT_INIT'),
    router.indexOf('req.command === RPC_PEERCHAT_PROFILE_SET')
  )
  const roomsRoute = router.slice(
    router.indexOf('req.command === RPC_PEERCHAT_ROOMS'),
    router.indexOf('req.command === RPC_PEERCHAT_BLOCK')
  )
  assert.match(initRoute, /blockedPeers: peerChat[.]listBlockedPeers[(][)]/)
  assert.match(roomsRoute, /blockedPeers: peerChat[.]listBlockedPeers[(][)]/)
})

test('every RPC command, app to backend and back, has a number of its own', async () => {
  const commands = await import('../../backend/rpc/commands.mjs')
  const numbers = Object.entries(commands).filter(([name]) => name.startsWith('RPC_')).map(([, value]) => value)
  assert.equal(new Set(numbers).size, numbers.length)
  assert.equal(commands.RPC_DEVICE_SYNC_STATUS, 16)
  assert.equal(commands.RPC_DEVICE_SYNC_NETWORK, 17)
  assert.equal(commands.RPC_DEVICE_SYNC_FORGET, 18)
  assert.equal(commands.RPC_APP_DEVICE_SYNC_CHANGED, 102)

  const router = await readFile(new URL('../../backend/rpc/router.mjs', import.meta.url), 'utf8')
  for (const name of ['RPC_DEVICE_SYNC_STATUS', 'RPC_DEVICE_SYNC_NETWORK', 'RPC_DEVICE_SYNC_FORGET']) {
    assert.match(router, new RegExp(`req[.]command === ${name}`))
  }
})
