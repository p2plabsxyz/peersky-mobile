import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import * as commands from '../../backend/rpc/commands.mjs'

const router = await readFile(new URL('../../backend/rpc/router.mjs', import.meta.url), 'utf8')
const routeOf = (name) => router.slice(router.indexOf(`req.command === ${name}`), router.indexOf('return\n    }', router.indexOf(`req.command === ${name}`)))

test('forwarding a file and searching every chat have numbers of their own', () => {
  assert.equal(commands.RPC_PEERCHAT_ATTACHMENT_FORWARD, 76)
  assert.equal(commands.RPC_PEERCHAT_SEARCH, 77)
  const numbers = Object.entries(commands).filter(([name]) => name.startsWith('RPC_')).map(([, value]) => value)
  assert.equal(new Set(numbers).size, numbers.length)
})

test('a forwarded file goes only between rooms this phone is in, sealed the way the target room seals', () => {
  const route = routeOf('RPC_PEERCHAT_ATTACHMENT_FORWARD')
  assert.match(route, /!peerChat\.hasRoom\(body\.roomKey\) \|\| !peerChat\.hasRoom\(body\.fromRoomKey\)/)
  assert.match(route, /forwardPeerChatAttachment\(\{ \.\.\.body, ownKey: peerChat\.filesHaveOwnKeys\(body\.roomKey\) \}\)/)
})

test('a search is answered by the service from what this phone keeps', () => {
  assert.match(routeOf('RPC_PEERCHAT_SEARCH'), /await peerChat\.searchMessages\(parseJsonMessage\(req\.data\)\)/)
})
