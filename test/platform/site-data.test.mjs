import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  describeSiteData,
  filterSiteData,
  getSiteDataHosts,
  normalizeSiteDataList
} from '../../app/privacy/site-data.mjs'

// Settings > Data Clearing > Cookies and site data lists the sites that keep
// cookies or data on the phone, and removes them one at a time or all at once.

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Android is asked about the websites in history, tabs and bookmarks, once each', () => {
  assert.deepEqual(getSiteDataHosts([
    'https://en.wikipedia.org/wiki/Peer-to-peer',
    'https://EN.wikipedia.org/wiki/BitTorrent',
    'http://example.com/',
    'hyper://blog.example/',
    'peersky://home',
    'http://127.0.0.1:8080/peertunes/',
    'http://localhost/',
    'not a url',
    undefined
  ]), ['en.wikipedia.org', 'example.com'])
})

test('the list is in order by name, without the app\'s own pages or anything odd', () => {
  const sites = normalizeSiteDataList([
    { name: 'www.wikipedia.org', cookies: true, storage: false },
    { name: 'duckduckgo.com', cookies: true, storage: true },
    { name: 'Startpage.com', cookies: false, storage: true },
    { name: 'duckduckgo.com', cookies: false },
    { name: '127.0.0.1', cookies: true },
    { name: 'bad name<script>', cookies: true },
    { name: '' },
    'nope'
  ])
  assert.deepEqual(sites.map((site) => site.name), ['duckduckgo.com', 'startpage.com', 'www.wikipedia.org'])
  assert.equal(describeSiteData(sites[0]), 'Cookies and site data')
  assert.equal(describeSiteData(sites[1]), 'Site data')
  assert.equal(describeSiteData(sites[2]), 'Cookies')
  assert.equal(describeSiteData({ cookies: false, storage: false }), 'Cached files')
  assert.deepEqual(filterSiteData(sites, ' WIKI ').map((site) => site.name), ['www.wikipedia.org'])
  assert.equal(filterSiteData(sites, '').length, 3)
  assert.deepEqual(normalizeSiteDataList(null), [])
})

test('iOS lists and removes whole sites from WebKit\'s records, never the app\'s own pages', async () => {
  const manager = await read('plugins/templates/PeerSkyWebViewManager.m.template')
  const list = manager.slice(manager.indexOf('RCT_EXPORT_METHOD(listSites'), manager.indexOf('RCT_EXPORT_METHOD(removeSites'))
  assert.match(list, /fetchDataRecordsOfTypes:\[WKWebsiteDataStore allWebsiteDataTypes\]/)
  assert.match(list, /\[appOwn containsObject:name\]\) continue/)
  const remove = manager.slice(manager.indexOf('RCT_EXPORT_METHOD(removeSites'))
  assert.match(remove, /\[wanted removeObject:@"127\.0\.0\.1"\];/)
  assert.match(remove, /removeDataOfTypes:types forDataRecords:matches/)
})

test('Android expires each cookie for the site and the domains above it, and is registered', async () => {
  const module = await read('plugins/templates/PeerSkyBrowserDataModule.kt.template')
  assert.match(module, /const val NAME = "PeerSkyBrowserData"/)
  assert.match(module, /Max-Age=0/)
  assert.match(module, /storage\.deleteOrigin\("\$scheme:\/\/\$host"\)/)
  assert.match(module, /host == "localhost" \|\| host == "127\.0\.0\.1"/)
  const pkg = await read('plugins/templates/BrowserContentBlockingPackage.kt.template')
  assert.match(pkg, /PeerSkyBrowserDataModule\(reactContext\)/)
  const plugin = await read('plugins/with-browser-downloads.js')
  assert.match(plugin, /'PeerSkyBrowserDataModule\.kt',\s+createBrowserDataModule\(packageName\)/)
})

test('Data Clearing leads to the list, and clearing there still keeps cookies', async () => {
  const clearing = await read('app/settings/DataClearing.tsx')
  assert.match(clearing, /title='Cookies and site data'/)
  assert.match(clearing, /onPress=\{onOpenSiteData\}/)
  const settings = await read('app/settings/SettingsScreen.tsx')
  assert.match(settings, /onOpenSiteData=\{\(\) => changePage\('site-data', 1\)\}/)
  assert.match(settings, /'site-data': 'data-clearing'/)
})
