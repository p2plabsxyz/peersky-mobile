import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  createHyperUrl,
  getHyperSearch,
  getHyperVisibility,
  parseHyperUrl
} from '../../backend/hyper/url.mjs'

// fetchHyper refused everything but GET, so a page could read a drive and
// never write to one. The publish flow in docs/P2P.md is two writes:
//
//   POST hyper://localhost/?key=myapp   creates or reuses a named drive
//   PUT  hyper://<key>/<name>           puts a file in it
//
// The first one is nothing without its query, and parseHyperUrl drops it.
const fetchSource = await readFile(new URL('../../backend/hyper/fetch.mjs', import.meta.url), 'utf8')

test('the query survives on a write address', () => {
  assert.equal(getHyperSearch('hyper://localhost/?key=myapp&visibility=public'), '?key=myapp&visibility=public')
})

test('an address with no query gains nothing', () => {
  assert.equal(getHyperSearch('hyper://drive/photo.png'), '')
  assert.equal(getHyperSearch('not a url'), '')
})

test('a fragment is not part of the request', () => {
  assert.equal(getHyperSearch('hyper://drive/?x=1#section'), '?x=1')
})

test('whatever comes back is already encoded, with no raw delimiters', () => {
  // URL percent-encodes these on the way in, so they are safe by the time the
  // allowlist sees them. The point of the check is that nothing raw gets past.
  assert.equal(getHyperSearch('hyper://drive/?a=<b>'), '?a=%3Cb%3E')
  assert.equal(getHyperSearch('hyper://drive/?a=" b'), '?a=%22%20b')

  for (const url of ['hyper://drive/?a=<b>', 'hyper://drive/?a=" b', 'hyper://drive/?a=x\ny']) {
    assert.doesNotMatch(getHyperSearch(url), /[\s<>"'`]/, url)
  }
})

test('the rebuilt write address is what a page asked for', () => {
  const url = 'hyper://localhost/?key=myapp'
  const target = parseHyperUrl(url)
  assert.equal(createHyperUrl(target.driveAddress, target.pathname) + getHyperSearch(url), url)
})

test('writes are the methods a page can publish with, and nothing else', () => {
  assert.match(fetchSource, /HYPER_READ_METHODS = new Set\(\['GET', 'HEAD'\]\)/)
  assert.match(fetchSource, /HYPER_WRITE_METHODS = new Set\(\['POST', 'PUT'\]\)/)
  assert.match(fetchSource, /is not supported over hyper:\/\//)
})

test('a write is never retried, because repeating it would upload twice', () => {
  const start = fetchSource.indexOf('async function writeHyper (')
  const body = fetchSource.slice(start, fetchSource.indexOf('\n}', start))
  assert.ok(start > -1, 'writeHyper is missing')
  assert.doesNotMatch(body, /withHyperRetry/)
})

test('a write carries the query and skips the page-rendering work', () => {
  const start = fetchSource.indexOf('async function writeHyper (')
  const body = fetchSource.slice(start, fetchSource.indexOf('\n}', start))
  // Inlining assets and proxying media exist to render a page, not to store one.
  assert.doesNotMatch(body, /inlineHyperAssets|startHyperAssetServer/)
  assert.match(fetchSource, /createHyperUrl\(target\.driveAddress, target\.pathname\) \+ getHyperSearch\(url\)/)
})

test('a body arrives as base64 and anything else is refused', () => {
  assert.match(fetchSource, /Request body must be base64 text/)
  assert.match(fetchSource, /Request body is not valid base64/)
})

// hypercore-fetch does not register the POST and PUT routes at all unless it
// was built writable, and this app built one read-only instance and used it for
// everything. Uploading from the Hyperdrive page came back to the page as
// "Load failed", which is what a failed fetch says, whatever the reason.
test('the page write path uses a writable hypercore-fetch, and reads do not', () => {
  const readFetch = fetchSource.indexOf('async function getHyperFetch (')
  const writeFetch = fetchSource.indexOf('async function getHyperWriteFetch (')
  assert.ok(readFetch > -1 && writeFetch > -1, 'both fetch builders should exist')
  assert.match(fetchSource.slice(readFetch, fetchSource.indexOf('\n}', readFetch)), /writable: false/)
  assert.match(fetchSource.slice(writeFetch, fetchSource.indexOf('\n}', writeFetch)), /writable: true/)
  assert.match(fetchSource, /const fetch = await getHyperWriteFetch\(runtime\)/)
})

test('both fetch instances are dropped together on a reset', () => {
  const start = fetchSource.indexOf('export function resetHyperFetch (')
  const body = fetchSource.slice(start, fetchSource.indexOf('\n}', start))
  assert.match(body, /hyperFetches = new WeakMap\(\)/)
  assert.match(body, /hyperWriteFetches = new WeakMap\(\)/)
})

// Publishing is POST then PUT. DELETE on a drive root throws the whole drive
// away, and nothing in the publish flow asks for it.
test('a page cannot delete a drive', () => {
  assert.match(fetchSource, /HYPER_WRITE_METHODS = new Set\(\['POST', 'PUT'\]\)/)
})

test('an upload that asked to be private is refused, not published', () => {
  assert.equal(getHyperVisibility('hyper://localhost/?key=myapp&visibility=private'), 'private')
  assert.equal(getHyperVisibility('hyper://localhost/?key=myapp&visibility=DEVICE'), 'device')
  assert.equal(getHyperVisibility('hyper://localhost/?key=myapp&visibility=public'), 'public')
  assert.equal(getHyperVisibility('hyper://localhost/?key=myapp'), '')
  assert.equal(getHyperVisibility('not a url'), '')

  const start = fetchSource.indexOf('async function writeHyper (')
  const body = fetchSource.slice(start, fetchSource.indexOf('\n}', start))
  assert.match(body, /PUBLIC_VISIBILITY/)
  assert.match(fetchSource, /PUBLIC_VISIBILITY = new Set\(\['', 'public'\]\)/)
})
