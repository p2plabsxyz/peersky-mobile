import assert from 'node:assert/strict'
import test from 'node:test'

import { listP2pSites, p2pSiteOf } from '../../app/p2p-sites.mjs'

// peersky://p2p lists the hyper:// sites this phone opened, from history, by
// title rather than key, so a site can be found and opened with no connection.

const KEY = 'nrymtobmkgz43jzs47gpf8t3gnqa9znxrxrfzrjxhjd6qwf1irgo'

test('one line per site, named by its home page, newest first', () => {
  const history = [
    { url: `hyper://${KEY}/posts/2.html`, title: 'Second post', visitedAt: 50 },
    { url: 'https://example.com/', title: 'Example', visitedAt: 40 },
    { url: 'hyper://blog.example/', title: 'A P2P blog', visitedAt: 30 },
    { url: `hyper://${KEY}/`, title: 'My garden', visitedAt: 20 },
    { url: 'hyper://blog.example/about', title: 'About', visitedAt: 10 }
  ]
  assert.deepEqual(listP2pSites(history), [
    { url: `hyper://${KEY}/`, title: 'My garden', visitedAt: 50 },
    { url: 'hyper://blog.example/', title: 'A P2P blog', visitedAt: 30 }
  ])
})

test('a site with no title anywhere goes by a short form of its key', () => {
  const history = [
    { url: `hyper://${KEY}/raw.txt`, title: `hyper://${KEY}/raw.txt`, visitedAt: 5 },
    { url: 'hyper://notes.example/x', title: 'First note', visitedAt: 3 }
  ]
  assert.deepEqual(listP2pSites(history), [
    { url: `hyper://${KEY}/raw.txt`, title: `${KEY.slice(0, 8)}…${KEY.slice(-4)}`, visitedAt: 5 },
    { url: 'hyper://notes.example/x', title: 'First note', visitedAt: 3 }
  ])
  assert.equal(p2pSiteOf('https://example.com/'), null)
  assert.equal(p2pSiteOf('not a url'), null)
})

test('a site seen only through inner pages opens the page it is named by, the one this phone keeps', () => {
  const history = [
    { url: `hyper://${KEY}/map.html`, title: 'Lake map', visitedAt: 9 },
    { url: `hyper://${KEY}/photos/1.jpg`, title: '', visitedAt: 8 }
  ]
  assert.deepEqual(listP2pSites(history), [{ url: `hyper://${KEY}/map.html`, title: 'Lake map', visitedAt: 9 }])
})

test('searching matches the titles shown, ignoring case', () => {
  const history = [
    { url: 'hyper://blog.example/', title: 'A P2P blog', visitedAt: 2 },
    { url: `hyper://${KEY}/`, title: 'My garden', visitedAt: 1 }
  ]
  assert.deepEqual(listP2pSites(history, '  GARDEN ').map((site) => site.title), ['My garden'])
  assert.deepEqual(listP2pSites(history, 'nothing like it'), [])
  assert.equal(listP2pSites(undefined).length, 0)
})

// Nothing in Settings led to the list. P2P Data, where the phone's Hyper data
// is managed, now opens it.
test('P2P Data in Settings opens the P2P sites list', async () => {
  const { readFile } = await import('node:fs/promises')
  const page = await readFile(new URL('../../app/settings/P2PStorage.tsx', import.meta.url), 'utf8')
  assert.match(page, /<SettingsSection title='P2P sites'>/)
  assert.match(page, /onPress=\{\(\) => onOpenUrl\(BROWSER_P2P_URL\)\}/)
})
