import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RPC_HYPER_CREATE_DRIVE,
  RPC_HYPER_FETCH,
  RPC_HYPER_INIT,
  RPC_HYPER_LAN_STATUS,
  RPC_HYPER_STORAGE_CLEAR_CACHE,
  RPC_HYPER_STORAGE_DELETE_APP,
  RPC_HYPER_STORAGE_LIST
} from '../../backend/rpc/commands.mjs'

test('Hyper storage and LAN discovery use distinct RPC command IDs', () => {
  const commands = [
    RPC_HYPER_INIT,
    RPC_HYPER_FETCH,
    RPC_HYPER_CREATE_DRIVE,
    RPC_HYPER_STORAGE_LIST,
    RPC_HYPER_STORAGE_DELETE_APP,
    RPC_HYPER_STORAGE_CLEAR_CACHE,
    RPC_HYPER_LAN_STATUS
  ]

  assert.deepEqual(commands, [1, 2, 3, 4, 5, 6, 7])
  assert.equal(new Set(commands).size, commands.length)
})
