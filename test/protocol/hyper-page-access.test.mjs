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
import { normalizeDriveAddressId } from '../../backend/hyper/runtime-routing.mjs'

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
  assert.equal(pageSiteId('hyper://localhost/'), null)
  assert.equal(pageSiteId('about:blank'), null)
})

// The Agregore scratchpad is an https:// page, and its hyper:// copy is opened
// under a domain name. Both were turned away with "Only a hyper:// page can
// make hyper:// requests", though the scratchpad publishes on desktop.
test('an https:// page is known by its origin and a hyper:// domain by its name', () => {
  assert.equal(pageSiteId('https://agregore.mauve.moe/apps/scratchpad.html'), 'https://agregore.mauve.moe')
  assert.equal(pageSiteId('https://Example.COM:8443/a/b?c#d'), 'https://example.com:8443')
  assert.equal(pageSiteId('hyper://Agregore.Mauve.Moe/apps/scratchpad.html'), 'agregore.mauve.moe')
  // Nothing else gets the bridge: plain http can be rewritten on the way.
  for (const page of ['http://example.com/', 'hyper://a%20b.com/', 'hyper://-bad.example/', 'data:text/html,x', 'file:///index.html']) {
    assert.equal(pageSiteId(page), null, page)
  }
})

// The backend runs in Bare, whose URL has no origin, so every https:// page
// came out as no site at all on the phone, while Node gave the right one.
test('an https:// page is known by its origin also where URL has none', () => {
  const NativeURL = globalThis.URL
  globalThis.URL = class extends NativeURL {
    get origin () { return undefined }
  }
  try {
    assert.equal(pageSiteId('https://agregore.mauve.moe/apps/scratchpad.html'), 'https://agregore.mauve.moe')
    assert.equal(pageSiteId('https://Example.COM:8443/a'), 'https://example.com:8443')
    assert.equal(pageSiteId('https://example.com:443/'), 'https://example.com')
  } finally {
    globalThis.URL = NativeURL
  }
})

test('a site with a name is never taken for a drive, so it reads no private one', () => {
  for (const page of ['https://agregore.mauve.moe/', 'hyper://agregore.mauve.moe/']) {
    const site = pageSiteId(page)
    assert.ok(site)
    // The private check lets a page through only when this is its drive.
    assert.equal(normalizeDriveAddressId(site), null, page)
  }
})

test('the same name from the https:// and hyper:// copies of a site gets two drives', () => {
  resetPageAccess()
  const web = pageSiteId('https://agregore.mauve.moe/apps/scratchpad.html')
  const hyper = pageSiteId('hyper://agregore.mauve.moe/apps/scratchpad.html')
  const name = (site) => new URL(namespacePageDriveRequest('hyper://localhost/?key=scratchpad', site).url).searchParams.get('key')
  assert.match(name(web), /^site-[0-9a-f]{16}-scratchpad$/)
  assert.notEqual(name(web), name(hyper))
  assert.notEqual(name(web), name(driveKey().hex))

  const created = driveKey()
  rememberPageDrive(web, `hyper://${created.z32}/`)
  assert.equal(pageMayWriteTo(web, created.hex), true)
  assert.equal(pageMayWriteTo(hyper, created.hex), false)
  assert.equal(pageMayWriteTo(pageSiteId('https://evil.example/'), created.hex), false)
  resetPageAccess()
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

// A private drive a linked desktop made after the link is not known here to be
// private until a read of it comes back as ciphertext. The phone then tried its
// own keys, read the drive again, and handed the files to the page that asked.
test('a page gets no private drive, also one found to be private only as it asked', () => {
  const unreadable = fetchSource.slice(fetchSource.indexOf('if (result?.ok === false && isUnreadableDriveError(result.error)) {'))
  const refused = unreadable.indexOf('if (otherPage) return { ok: false, status: 403, error: PAGE_PRIVATE_DRIVE_ERROR }')
  assert.ok(refused > -1, 'a page is not turned away when the drive reads as ciphertext')
  assert.ok(refused < unreadable.indexOf('adoptLinkedPrivateDriveIfReadable'), 'the keys are tried before the page is turned away')
  assert.ok(refused < unreadable.indexOf('return read()'), 'the drive is read again for the page')
  // Its own pages still read it, and the app itself is no page.
  assert.match(fetchSource, /const otherPage = Boolean\(pageSite\) && normalizeDriveAddressId\(target\.driveAddress\) !== pageSite/)
  assert.match(fetchSource, /if \(otherPage && await isPrivateHyperAddress\(target\.driveAddress\)\)/)
})

test('the fetch path applies all of it to page requests', () => {
  assert.match(fetchSource, /page = null/)
  assert.match(fetchSource, /Only a hyper:\/\/ or https:\/\/ page can make hyper:\/\/ requests/)
  assert.match(fetchSource, /const PAGE_PRIVATE_DRIVE_ERROR = 'A page cannot read private drives'/)
  assert.match(fetchSource, /isPrivateHyperAddress\(target\.driveAddress\)/)
  assert.match(fetchSource, /namespacePageDriveRequest\(requestUrl, pageSite\)/)
  assert.match(fetchSource, /A page can only write to drives it created/)
  assert.match(fetchSource, /rememberPageDrive\(pageSite, responseText\)/)
})
