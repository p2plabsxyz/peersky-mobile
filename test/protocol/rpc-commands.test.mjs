import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT,
  RPC_HYPER_LIBRARY_LIST,
  RPC_HYPER_LIBRARY_UPLOAD,
  RPC_HYPER_LAN_STATUS,
  RPC_HYPER_STORAGE_CLEAR_ALL,
  RPC_HYPER_STORAGE_CLEAR_CACHE,
  RPC_HYPER_STORAGE_DELETE_APP,
  RPC_HYPER_STORAGE_LIST,
  RPC_PEERCHAT_INIT,
  RPC_PEERCHAT_PROFILE_SET,
  RPC_PEERCHAT_ROOM_CREATE,
  RPC_PEERCHAT_ROOM_JOIN,
  RPC_PEERCHAT_ROOMS,
  RPC_PEERCHAT_SNAPSHOT,
  RPC_PEERCHAT_SEND,
  RPC_PEERCHAT_ROOM_LEAVE,
  RPC_PEERCHAT_REACT
} from '../../backend/rpc/commands.mjs'

test('Hyper storage and LAN discovery use distinct RPC command IDs', () => {
  const commands = [
    RPC_HYPER_INIT,
    RPC_HYPER_FETCH,
    RPC_HYPER_CREATE_DRIVE,
    RPC_HYPER_STORAGE_LIST,
    RPC_HYPER_STORAGE_DELETE_APP,
    RPC_HYPER_STORAGE_CLEAR_CACHE,
    RPC_HYPER_LIBRARY_LIST,
    RPC_HYPER_LIBRARY_UPLOAD,
    RPC_HYPER_LAN_STATUS,
    RPC_HYPER_STORAGE_CLEAR_ALL
  ]

  assert.deepEqual(commands, [1, 2, 3, 4, 5, 6, 7, 8, 9, 14])
  assert.equal(new Set(commands).size, commands.length)
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
    RPC_PEERCHAT_REACT
  ]

  assert.deepEqual(commands, [40, 41, 42, 43, 44, 45, 46, 47, 48])
  assert.equal(new Set(commands).size, commands.length)
})
