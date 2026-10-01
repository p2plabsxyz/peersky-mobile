import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import z32 from 'z32'

import {
  isNamedDriveRequest,
  namespacePageDriveRequest,
  pageMayWriteTo,
  pageSiteId,
  rememberPageDrive,
  resetPageAccess
} from '../../backend/hyper/page-access.mjs'

// A hyper:// page used to reach the app's own drives by name and write to
// them without asking: `?key=p2pmd` from any page was P2PMD's publish drive.
const fetchSource = await readFile(new URL('../../backend/hyper/fetch.mjs', import.meta.url), 'utf8')

function driveKey () {
  const key = randomBytes(32)
  return { hex: key.toString('hex'), z32: z32.encode(key) }
}

test('a page is known by its own drive, in either spelling', () => {
  const site = driveKey()
  assert.equal(pageSiteId(`hyper://${site.z32}/index.html`), site.hex)
  assert.equal(pageSiteId(`hyper://${site.hex}/`), site.hex)
  assert.equal(pageSiteId('https://example.com/'), null)
  assert.equal(pageSiteId('hyper://localhost/'), null)
  assert.equal(pageSiteId('about:blank'), null)
})

test('only POST to localhost with a key asks for a named drive', () => {
  assert.equal(isNamedDriveRequest('hyper://localhost/?key=notes', 'POST'), true)
  assert.equal(isNamedDriveRequest('hyper://localhost/?key=notes', 'PUT'), false)
  assert.equal(isNamedDriveRequest('hyper://localhost/', 'POST'), false)
  assert.equal(isNamedDriveRequest(`hyper://${driveKey().z32}/?key=notes`, 'POST'), false)
})

test('a page asking for an app drive by name gets one of its own', () => {
  const first = driveKey().hex
  const second = driveKey().hex
  const fromFirst = new URL(namespacePageDriveRequest('hyper://localhost/?key=p2pmd&visibility=public', first).url)
  const fromSecond = new URL(namespacePageDriveRequest('hyper://localhost/?key=p2pmd', second).url)

  for (const name of [fromFirst.searchParams.get('key'), fromSecond.searchParams.get('key')]) {
    assert.notEqual(name, 'p2pmd')
    assert.match(name, /^site-[0-9a-f]{16}-p2pmd$/)
  }
  assert.notEqual(fromFirst.searchParams.get('key'), fromSecond.searchParams.get('key'))
  assert.equal(fromFirst.searchParams.get('visibility'), 'public')
  // The same site asking again gets the same drive.
  assert.equal(
    new URL(namespacePageDriveRequest('hyper://localhost/?key=p2pmd', first).url).searchParams.get('key'),
    fromFirst.searchParams.get('key')
  )
})

test('a drive name with anything odd in it is refused', () => {
  const site = driveKey().hex
  for (const name of ['', '../p2pmd', 'a b', '-lead', 'x'.repeat(65)]) {
    const url = `hyper://localhost/?key=${encodeURIComponent(name)}`
    assert.ok(namespacePageDriveRequest(url, site).error, JSON.stringify(name))
  }
})

test('a page writes only to drives it created', () => {
  resetPageAccess()
  const site = driveKey().hex
  const other = driveKey().hex
  const created = driveKey()
  const appDrive = driveKey()

  assert.equal(pageMayWriteTo(site, created.z32), false)
  rememberPageDrive(site, `hyper://${created.z32}/\n`)
  assert.equal(pageMayWriteTo(site, created.z32), true)
  assert.equal(pageMayWriteTo(site, created.hex), true)
  assert.equal(pageMayWriteTo(other, created.z32), false)
  assert.equal(pageMayWriteTo(site, appDrive.z32), false)
  assert.equal(pageMayWriteTo(null, created.z32), false)
  resetPageAccess()
  assert.equal(pageMayWriteTo(site, created.z32), false)
})

test('the fetch path applies all of it to page requests', () => {
  assert.match(fetchSource, /page = null/)
  assert.match(fetchSource, /Only a hyper:\/\/ page can make hyper:\/\/ requests/)
  assert.match(fetchSource, /A page cannot read private drives/)
  assert.match(fetchSource, /isPrivateHyperAddress\(target\.driveAddress\)/)
  assert.match(fetchSource, /namespacePageDriveRequest\(requestUrl, pageSite\)/)
  assert.match(fetchSource, /A page can only write to drives it created/)
  assert.match(fetchSource, /rememberPageDrive\(pageSite, responseText\)/)
})
