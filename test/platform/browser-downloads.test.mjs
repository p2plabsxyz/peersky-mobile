import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { createRequire } from 'node:module'
import {
  addDownloadUrlFingerprint,
  describeBrowserDownload,
  downloadFilenameFromHeaders,
  findCompletedHyperDownload,
  getProxiedHyperUrl,
  MAX_BROWSER_DOWNLOADS,
  createUniqueDownloadFilename,
  normalizeBrowserDownloads,
  normalizeBrowserDownloadUrl,
  sortBrowserDownloads
} from '../../app/downloads/browser-downloads.mjs'
import { BROWSER_HOME_URL, getFileHandoffAction } from '../../app/browser-shell.mjs'

const require = createRequire(import.meta.url)
const downloadsPlugin = require('../../plugins/with-browser-downloads')

describe('browser downloads', () => {
  // iOS asks before a page's download is saved, naming the file and the site.
  test('names a download for the prompt that asks first', () => {
    assert.deepEqual(describeBrowserDownload('https://files.example.com/a/Report%20Q3.pdf?x=1'), {
      name: 'Report Q3.pdf',
      host: 'files.example.com'
    })
    assert.deepEqual(describeBrowserDownload('https://example.com/'), { name: 'download', host: 'example.com' })
    assert.deepEqual(describeBrowserDownload('https://example.com/..%2F..%2Fetc'), { name: '.._.._etc', host: 'example.com' })
    assert.deepEqual(describeBrowserDownload('not a url'), { name: 'download', host: '' })

    const index = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(index, /'Download this file\?'/)
  })

  // A link that opens in a new tab, or an address typed in, can be a file. The
  // WebView loads nothing for it, and the tab was left blank.
  test('a tab that only went to a file goes back to where it was', () => {
    const fileUrl = 'https://example.com/a.zip'
    const home = { url: BROWSER_HOME_URL, source: { kind: 'home' } }
    const page = { url: 'https://example.com/', source: { kind: 'web', uri: 'https://example.com/' } }
    const file = { url: fileUrl, source: { kind: 'web', uri: fileUrl } }

    // A new tab for the file has nothing to go back to, so it closes, even
    // when the file came through a redirect.
    assert.deepEqual(getFileHandoffAction({ history: [file], historyIndex: 0, fileUrl, showedPage: false }), { action: 'close-tab' })
    assert.deepEqual(getFileHandoffAction({ history: [file], historyIndex: 0, fileUrl, showedPage: true }), { action: 'close-tab' })
    assert.deepEqual(getFileHandoffAction({ history: [file], historyIndex: 0, fileUrl: 'https://cdn.example.net/a.zip', showedPage: false }), { action: 'close-tab' })
    // Typed in from home: home again, with no file ahead of it.
    const fromHome = getFileHandoffAction({ history: [home, file], historyIndex: 1, fileUrl, showedPage: false })
    assert.deepEqual(fromHome.state.history, [home])
    assert.equal(fromHome.state.canGoForward, false)
    // Typed in over a page that is still on screen: that page, under its own
    // address.
    const overPage = getFileHandoffAction({ history: [home, page, file], historyIndex: 2, fileUrl: `${fileUrl}#top`, showedPage: true })
    assert.equal(overPage.action, 'back')
    assert.equal(overPage.state.currentUrl, page.url)
    // A link on a page: the page is still there, and so is the tab.
    assert.deepEqual(getFileHandoffAction({ history: [page], historyIndex: 0, fileUrl, showedPage: true }), { action: 'stay' })
    assert.deepEqual(getFileHandoffAction({ history: [home, page], historyIndex: 1, fileUrl, showedPage: true }), { action: 'stay' })

    const index = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    // A WebView has shown a page once one has finished in it. It is known by
    // its native view tag: the WebView's ref is a new object as it renders,
    // so a page tapped to a file looked like a blank tab and went back.
    assert.match(index, /onLoadEnd=\{\(event\) => \{\s+const webViewTag = getNativeViewTag\(event\)\s+if \(webViewTag !== null\) browserWebViewsShowingPageRef\.current\.add\(webViewTag\)/)
    assert.match(index, /onFileDownload=\{\(event\) => confirmPageDownload\(event\.nativeEvent\.downloadUrl, tab\.id, getNativeViewTag\(event\)\)\}/)
    // A tab closed for its file goes back to the tab that opened it.
    assert.match(index, /browserTabOpenersRef\.current\.set\(browserTabsStateRef\.current\.activeTabId, openerTabId\)/)
    assert.match(index, /onBrowserCloseTab\(tabId, browserTabOpenersRef\.current\.get\(tabId\)\)/)
  })

  // iOS fetches a page's file itself now, so it names the file the way the
  // server says.
  test('names a download from Content-Disposition, RFC 5987 first, or from its address', () => {
    const named = (disposition) => downloadFilenameFromHeaders({ 'Content-Disposition': disposition }, 'https://x.test/a')
    assert.equal(named("attachment; filename*=UTF-8''Report%20Q3.pdf; filename=\"fallback.pdf\""), 'Report Q3.pdf')
    assert.equal(downloadFilenameFromHeaders({ 'content-disposition': 'attachment; filename="notes.txt"' }, 'https://x.test/a'), 'notes.txt')
    assert.equal(named('attachment; filename=plain.zip'), 'plain.zip')
    // A path in the name leads nowhere but Downloads.
    assert.equal(named('attachment; filename="../../etc/passwd"'), 'passwd')
    assert.equal(downloadFilenameFromHeaders({}, 'https://files.example.com/a/Report%20Q3.pdf?x=1'), 'Report Q3.pdf')
    assert.equal(downloadFilenameFromHeaders(undefined, 'https://example.com/'), 'download')
  })

  // On iOS a download showed nothing until it was done, then sat in Downloads
  // with nothing to do with it, since the app's own folder stays out of Files.
  test('an iOS download shows its progress and can be saved to Files', () => {
    const hook = readFileSync(new URL('../../app/downloads/useBrowserDownloads.ts', import.meta.url), 'utf8')
    assert.match(hook, /createDownloadResumable\(/)
    assert.match(hook, /downloadedBytes: totalBytesWritten,/)
    assert.match(hook, /const result = await PeerSkyShare\.saveToFiles\(id\)/)
    const screen = readFileSync(new URL('../../app/downloads/DownloadsScreen.tsx', import.meta.url), 'utf8')
    assert.match(screen, /\{download\.status === 'complete' && Platform\.OS === 'ios' && onSaveToFiles && \(/)
    const share = readFileSync(new URL('../../plugins/templates/PeerSkyShareModule.m.template', import.meta.url), 'utf8')
    assert.match(share, /RCT_EXPORT_METHOD\(saveToFiles:/)
    // A copy, so the download stays in PeerSky as well.
    assert.match(share, /initForExportingURLs:@\[url\] asCopy:YES/)
    const app = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(app, /onSaveToFiles=\{\(downloadId\) => void saveBrowserDownloadToFiles\(downloadId\)\}/)
    // Asked for from a page or the media viewer, a file opens Downloads, where
    // its progress shows.
    assert.match(app, /function startBrowserDownload \(downloadUrl: string, tabId: string \| null\) \{\s+void requestBrowserDownload\(downloadUrl, \{ incognito: tabId !== null && isIncognitoTab\(tabId\) \}\)\s+setBrowserMenuVisible\(false\)\s+setBrowserDownloadsVisible\(true\)/)
    assert.match(app, /function onBrowserMediaDownload \(targetUrl: string, tabId: string \| null\) \{\s+startBrowserDownload\(targetUrl, tabId\)/)
  })

  // A download from an incognito tab sent the cookies every other tab shares,
  // which told the site who was on the other end.
  test('an incognito tab\'s download sends none of the shared cookies', () => {
    const app = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    assert.match(app, /\{ text: 'Download', onPress: \(\) => startBrowserDownload\(downloadUrl, tabId\) \}/)
    assert.match(app, /onDownload=\{\(targetUrl\) => void onBrowserMediaDownload\(targetUrl, browserMediaTarget\?\.tabId \?\? null\)\}/)

    const hook = readFileSync(new URL('../../app/downloads/useBrowserDownloads.ts', import.meta.url), 'utf8')
    assert.match(hook, /const cookieHeader = incognito \? null : await CookieManager\.getCookieHeader\(normalizedUrl, true\)/)
    assert.match(hook, /getAndroidDownloads\(\)\.requestDownload\(normalizedUrl, incognito\)/)
    assert.match(hook, /await requestDownload\(normalizedUrl, \{ incognito: download\.incognito === true \}\)/)

    const manager = readFileSync(new URL('../../plugins/templates/PeerSkyWebViewManager.kt.template', import.meta.url), 'utf8')
    assert.match(manager, /val incognito = privateWebViews\.containsKey\(wrapper\.webView\)/)
    assert.match(manager, /mimeType,\s+incognito,\s+incognitoCookies\s+\)/)
    const module = readFileSync(new URL('../../plugins/templates/BrowserDownloadsModule.kt.template', import.meta.url), 'utf8')
    // The shared jar is reached only through the one rule that leaves it out
    // for an incognito tab.
    assert.equal(module.match(/CookieManager\.getInstance\(\)/g).length, 1)
    assert.match(module, /downloadCookieJar\(incognito, incognitoCookies\) \{ CookieManager\.getInstance\(\) \}/)
    assert.match(module, /\.put\("incognito", download\.incognito\)/)

    const [kept] = normalizeBrowserDownloads([{ id: 'r-1', name: 'a.pdf', status: 'failed', createdAt: 1, incognito: true }])
    assert.equal(kept.incognito, true)
    const [plain] = normalizeBrowserDownloads([{ id: 'r-2', name: 'b.pdf', status: 'failed', createdAt: 1, incognito: 'yes' }])
    assert.equal('incognito' in plain, false)
  })

  test('accepts only safe HTTP download URLs', () => {
    assert.equal(normalizeBrowserDownloadUrl('https://example.com/file.pdf'), 'https://example.com/file.pdf')
    assert.equal(normalizeBrowserDownloadUrl('file:///private.txt'), null)
    assert.equal(normalizeBrowserDownloadUrl('https://user:secret@example.com/file'), null)
    assert.equal(normalizeBrowserDownloadUrl('not a url'), null)
  })

  test('normalizes and bounds native download records', () => {
    const records = Array.from({ length: MAX_BROWSER_DOWNLOADS + 5 }, (_, index) => ({
      id: index + 1,
      name: `file-${index}.txt`,
      status: index === 0 ? 'complete' : 'unknown',
      size: index === 0 ? 42 : -1,
      createdAt: index
    }))
    const downloads = normalizeBrowserDownloads(records)

    assert.equal(downloads.length, MAX_BROWSER_DOWNLOADS)
    assert.equal(downloads[0].id, String(MAX_BROWSER_DOWNLOADS + 5))
    assert.equal(downloads.at(-1).id, '6')
    assert.equal(downloads.every(({ status }) => status === 'failed'), true)
  })

  test('keeps only known native pause and failure reasons', () => {
    const downloads = normalizeBrowserDownloads([
      { id: '1', name: 'waiting.zip', status: 'paused', reason: 'waiting-for-network', size: 0, createdAt: 2 },
      { id: '2', name: 'unsafe.zip', status: 'failed', reason: 'arbitrary text', size: 0, createdAt: 1 }
    ])

    assert.equal(downloads[0].reason, 'waiting-for-network')
    assert.equal(downloads[1].reason, undefined)
  })

  test('normalizes persisted resumable progress', () => {
    const [download] = normalizeBrowserDownloads([{
      id: 'r:test',
      name: 'large-video.mp4',
      status: 'paused',
      reason: 'user-paused',
      size: 1_000,
      downloadedBytes: 400,
      totalBytes: 1_000,
      createdAt: 1
    }])

    assert.equal(download.downloadedBytes, 400)
    assert.equal(download.totalBytes, 1_000)
  })

  test('drops malformed records', () => {
    assert.deepEqual(normalizeBrowserDownloads([
      null,
      { id: '', name: 'missing-id' },
      { id: '1', name: '' }
    ]), [])
  })

  test('reopens a completed download for the same proxied Hyper file', () => {
    const hyperUrl = 'hyper://example.test/manual.pdf'
    const sourceUrl = `http://127.0.0.1:1234/asset?url=${encodeURIComponent(hyperUrl)}&download=1`
    const downloads = normalizeBrowserDownloads([
      { id: '1', name: 'manual.pdf', status: 'complete', size: 42, createdAt: 2, sourceUrl },
      { id: '2', name: 'manual.pdf', status: 'running', size: 0, createdAt: 3, sourceUrl }
    ])

    assert.equal(findCompletedHyperDownload(downloads, { url: hyperUrl })?.id, '1')
    assert.equal(findCompletedHyperDownload(downloads, {
      name: 'other.pdf',
      url: 'hyper://example.test/other.pdf'
    }), null)
  })

  test('identifies a Hyper source behind the authenticated download proxy', () => {
    const hyperUrl = 'hyper://example.com/archive.zip'
    const sourceUrl = `http://127.0.0.1:1234/asset?token=test&url=${encodeURIComponent(hyperUrl)}&download=1`
    assert.equal(getProxiedHyperUrl(sourceUrl), hyperUrl)
    assert.equal(getProxiedHyperUrl('https://example.com/archive.zip'), null)
  })

  test('matches equivalent literal and escaped Hyper path delimiters', () => {
    const downloadedUrl = 'hyper://example.com/video%20one%2C%20two.mp4'
    const recentUrl = 'hyper://example.com/video%20one,%20two.mp4'
    const sourceUrl = `http://127.0.0.1:1234/asset?url=${encodeURIComponent(downloadedUrl)}`
    const downloads = normalizeBrowserDownloads([{
      id: 'video',
      name: 'video one, two.mp4',
      status: 'complete',
      size: 42,
      createdAt: 1,
      sourceUrl
    }])

    assert.equal(findCompletedHyperDownload(downloads, { url: recentUrl })?.id, 'video')
  })

  test('does not open an unrelated legacy download with the same filename', () => {
    const downloads = normalizeBrowserDownloads([
      { id: 'legacy', name: 'manual.pdf', status: 'complete', size: 42, createdAt: 1 }
    ])

    assert.equal(findCompletedHyperDownload(downloads, {
      name: 'manual.pdf',
      url: 'hyper://example.test/manual.pdf'
    }), null)
  })

  test('validates records before retaining the newest 200', () => {
    const malformed = Array.from({ length: MAX_BROWSER_DOWNLOADS + 10 }, () => null)
    const valid = Array.from({ length: MAX_BROWSER_DOWNLOADS + 5 }, (_, index) => ({
      id: `valid-${index}`,
      name: `valid-${index}.txt`,
      status: 'complete',
      size: index,
      createdAt: index
    }))
    const downloads = normalizeBrowserDownloads([...malformed, ...valid])

    assert.equal(downloads.length, MAX_BROWSER_DOWNLOADS)
    assert.equal(downloads[0].id, `valid-${MAX_BROWSER_DOWNLOADS + 4}`)
    assert.equal(downloads.at(-1).id, 'valid-5')
  })

  test('does not split Unicode download names while bounding metadata', () => {
    const emoji = '\u{1F600}'
    const name = `${'a'.repeat(254)}${emoji}tail`
    const [download] = normalizeBrowserDownloads([{
      id: '1',
      name,
      status: 'complete',
      size: 1,
      createdAt: 1
    }])

    assert.equal(Array.from(download.name).length, 255)
    assert.equal(download.name.endsWith(emoji), true)
  })

  test('disambiguates duplicate filenames while preserving extensions', () => {
    const downloads = normalizeBrowserDownloads([
      { id: '1', name: 'report.pdf', status: 'complete', size: 1, createdAt: 1 },
      { id: '2', name: 'report.pdf', status: 'complete', size: 1, createdAt: 2 },
      { id: '3', name: 'report.pdf', status: 'complete', size: 1, createdAt: 3 }
    ])

    assert.deepEqual(
      downloads.map((download) => download.name),
      ['report.pdf', 'report (1).pdf', 'report (2).pdf']
    )
  })

  test('distinguishes query-addressed images while preserving repeat collision suffixes', () => {
    const first = addDownloadUrlFingerprint('images.jpg', 'https://example.com/images?id=first')
    const second = addDownloadUrlFingerprint('images.jpg', 'https://example.com/images?id=second')

    assert.notEqual(first, second)
    assert.equal(
      addDownloadUrlFingerprint('images.jpg', 'https://example.com/images?id=first#preview'),
      first
    )
    assert.match(first, /^images-[a-f0-9]{8}[.]jpg$/)
    assert.equal(
      createUniqueDownloadFilename(first, [first]),
      first.replace('.jpg', ' (1).jpg')
    )
    assert.equal(
      addDownloadUrlFingerprint('photo.jpg', 'https://example.com/photo.jpg?token=one'),
      'photo.jpg'
    )
  })

  test('sorts downloads without mutating the source records', () => {
    const downloads = [
      { id: '2', name: 'file-10.txt', size: 10, createdAt: 200 },
      { id: '1', name: 'File-2.txt', size: 30, createdAt: 100 },
      { id: '3', name: 'archive.zip', size: 20, createdAt: 300 }
    ]

    assert.deepEqual(
      sortBrowserDownloads(downloads, 'newest').map(({ id }) => id),
      ['3', '2', '1']
    )
    assert.deepEqual(
      sortBrowserDownloads(downloads, 'oldest').map(({ id }) => id),
      ['1', '2', '3']
    )
    assert.deepEqual(
      sortBrowserDownloads(downloads, 'name').map(({ id }) => id),
      ['3', '1', '2']
    )
    assert.deepEqual(
      sortBrowserDownloads(downloads, 'size').map(({ id }) => id),
      ['1', '3', '2']
    )
    assert.deepEqual(downloads.map(({ id }) => id), ['2', '1', '3'])
  })

  test('generates collision-free iOS destination names', () => {
    assert.equal(createUniqueDownloadFilename('report.pdf', []), 'report.pdf')
    assert.equal(
      createUniqueDownloadFilename('report.pdf', ['report.pdf', 'report (1).pdf']),
      'report (2).pdf'
    )
    assert.equal(createUniqueDownloadFilename('../unsafe.pdf', []), '.._unsafe.pdf')
  })

  test('keeps the browser downloads config plugin enabled', () => {
    const appConfig = JSON.parse(
      readFileSync(new URL('../../app.json', import.meta.url), 'utf8')
    )

    assert.equal(
      appConfig.expo.plugins.includes('./plugins/with-browser-downloads'),
      true
    )
  })

  test('generates and registers the Android download bridge idempotently', () => {
    const mainApplication = 'PackageList(this).packages.apply {\n        }'
    const registered = downloadsPlugin.addPackageRegistration(mainApplication)
    const moduleSource = downloadsPlugin.createDownloadsModule('xyz.test.browser')
    const packageSource = downloadsPlugin.createDownloadsPackage('xyz.test.browser')
    const webViewManagerSource = downloadsPlugin.createWebViewManager('xyz.test.browser')
    const unitTestSource = downloadsPlugin.createDownloadsModuleTest('xyz.test.browser')

    assert.match(registered, /add\(BrowserDownloadsPackage\(\)\)/)
    assert.equal(downloadsPlugin.addPackageRegistration(registered), registered)
    assert.match(moduleSource, /package xyz\.test\.browser/)
    assert.match(moduleSource, /@ReactModule\(name = BrowserDownloadsModule[.]NAME\)/)
    assert.match(moduleSource, /const val NAME = "BrowserDownloads"/)
    assert.match(moduleSource, /fun requestDownload\(url: String, incognito: Boolean, promise: Promise\)/)
    assert.match(moduleSource, /sourceUrl = url/)
    assert.match(moduleSource, /record[.]putString\("sourceUrl", it\)/)
    assert.match(moduleSource, /promise[.]resolve\(queueDownload\(url, null, null, null, incognito\)\)/)
    assert.match(moduleSource, /fun openDownload\(id: String, promise: Promise\)/)
    // In a PeerSky folder of Download, not loose among every other app's files.
    assert.match(moduleSource, /put\(MediaStore\.MediaColumns\.RELATIVE_PATH, Environment\.DIRECTORY_DOWNLOADS \+ "\/PeerSky"\)/)
    assert.match(moduleSource, /fun pauseDownload\(id: String, promise: Promise\)/)
    assert.match(moduleSource, /DownloadManager[.]COLUMN_REASON/)
    assert.match(moduleSource, /resolveDownloadMetadata/)
    assert.match(moduleSource, /addUrlFingerprintIfNeeded/)
    assert.match(moduleSource, /fragment\(null\)/)
    assert.match(moduleSource, /MessageDigest[.]getInstance\("SHA-256"\)/)
    assert.match(moduleSource, /CONTENT_DISPOSITION_FILENAME_PATTERN/)
    assert.match(moduleSource, /resolveMimeTypeFromFilename/)
    assert.match(moduleSource, /takeUnless\(::isAmbiguousDownloadType\)/)
    assert.match(moduleSource, /requestMethod = "HEAD"/)
    assert.match(moduleSource, /status in 200[.][.]299/)
    assert.match(moduleSource, /contentDisposition/)
    assert.match(moduleSource, /ContentInfoUtil/)
    assert.match(moduleSource, /MAX_ACTIVE_DOWNLOADS = 3/)
    assert.match(moduleSource, /MAX_DOWNLOADS_PER_WINDOW = 10/)
    assert.match(moduleSource, /MAX_RECONCILIATIONS_PER_REFRESH = 2/)
    assert.match(moduleSource, /MAX_RECONCILE_ATTEMPTS = 3/)
    assert.match(moduleSource, /DownloadManager[.]ACTION_DOWNLOAD_COMPLETE/)
    assert.match(moduleSource, /DownloadManager[.]COLUMN_MEDIAPROVIDER_URI/)
    assert.match(moduleSource, /fun hasDownloadCapacity\(\)/)
    assert.match(
      moduleSource,
      /hasMeaningfulExtension\(initialName\) &&\s+!isAmbiguousDownloadType\(mimeType\)/
    )
    assert.match(
      moduleSource,
      /val mimeType = stored[?][.]mimeType\s+[?]: manager[.]getMimeTypeForDownloadedFile/
    )
    assert.match(moduleSource, /MAX_SIGNATURE_BYTES = 131072/)
    assert.match(moduleSource, /MAX_ARCHIVE_SCAN_BYTES = 8L [*] 1024L [*] 1024L/)
    assert.match(moduleSource, /AndroidManifest[.]xml/)
    assert.match(moduleSource, /hasManifest && hasPackageContent/)
    assert.doesNotMatch(moduleSource, /startsWithMpegAudioFrame/)
    assert.doesNotMatch(moduleSource, /stored[?][.]let \{ findPublicDownloadUri/)
    assert.match(moduleSource, /com[.]reactnativecommunity[.]webview[.]URLUtil/)
    assert.match(moduleSource, /MediaStore[.]MediaColumns[.]IS_PENDING/)
    assert.match(moduleSource, /setRequestProperty\("Range", "bytes=" [+ ] offset [+] "-"\)/)
    assert.match(moduleSource, /status != HttpURLConnection[.]HTTP_PARTIAL/)
    assert.match(moduleSource, /parseContentRangeStart\(responseRange\) != offset/)
    assert.match(moduleSource, /fun resumeDownload\(id: String, url: String, promise: Promise\)/)
    // No REQUEST_INSTALL_PACKAGES: an APK goes to the system's Downloads,
    // which installs it after its own warning.
    assert.match(moduleSource, /Intent\(DownloadManager[.]ACTION_VIEW_DOWNLOADS\)/)
    assert.doesNotMatch(moduleSource, /canRequestPackageInstalls|ACTION_MANAGE_UNKNOWN_APP_SOURCES/)
    assert.match(moduleSource, /resolveMimeTypeFromFilename\(download[.]name, download[.]mimeType\)/)
    assert.doesNotMatch(moduleSource, /manager[.]remove\(downloadId\).*user-paused/s)
    assert.match(moduleSource, /getSharedPreferences/)
    assert.match(packageSource, /listOf\(PeerSkyWebViewManager\(\)\)/)
    assert.match(webViewManagerSource, /setDownloadListener/)
    assert.match(webViewManagerSource, /queueDownload/)
    assert.match(webViewManagerSource, /Download service is unavailable[.]/)
    // A page can start a download without a tap. It only queues on a yes.
    assert.match(webViewManagerSource, /confirmDownload\(context, name, url, contentLength\) \{\s+downloads[.]queueDownload\(/)
    // The prompt names the file the way the download will, not Android's raw
    // guess, which turned a .txt sent as octet-stream into .bin.
    assert.match(webViewManagerSource, /val name = downloads[.]resolveFilename\(url, contentDisposition, mimeType\)/)
    assert.doesNotMatch(webViewManagerSource, /URLUtil[.]guessFileName/)
    assert.match(webViewManagerSource, /setTitle\("Download this file\?"\)/)
    assert.match(webViewManagerSource, /setPositiveButton\("Download"\) \{ _, _ -> onConfirm\(\) \}/)
    assert.match(webViewManagerSource, /setOnLongClickListener/)
    assert.match(webViewManagerSource, /setOnTouchListener/)
    assert.match(webViewManagerSource, /MotionEvent[.]ACTION_DOWN/)
    assert.match(webViewManagerSource, /dispatchDomTarget/)
    assert.match(webViewManagerSource, /__peerskyResolveMediaLongPressAt/)
    assert.match(webViewManagerSource, /HitTestResult[.]IMAGE_TYPE/)
    assert.match(webViewManagerSource, /HitTestResult[.]SRC_IMAGE_ANCHOR_TYPE/)
    assert.match(webViewManagerSource, /HitTestResult[.]SRC_ANCHOR_TYPE/)
    assert.match(webViewManagerSource, /requestFocusNodeHref/)
    assert.match(webViewManagerSource, /Handler\(Looper[.]getMainLooper\(\)\)/)
    assert.match(webViewManagerSource, /mediaLongPressToken/)
    assert.match(webViewManagerSource, /override fun getDelegate/)
    assert.match(webViewManagerSource, /propName == "mediaLongPressToken"/)
    assert.match(webViewManagerSource, /inheritedDelegate[.]setProperty/)
    assert.match(webViewManagerSource, /peersky-browser-media-long-press/)
    assert.match(webViewManagerSource, /MAX_URL_LENGTH = 8192/)
    assert.match(webViewManagerSource, /parsed[.]userInfo == null/)
    assert.match(webViewManagerSource, /else -> dispatchDomTarget\(webView\)/)
    assert.match(webViewManagerSource, /val result = webView[.]hitTestResult/)
    assert.match(webViewManagerSource, /private fun dispatchDomTarget[\s\S]*?: Boolean/)
    assert.doesNotMatch(webViewManagerSource, /MotionEvent[.]ACTION_UP, MotionEvent[.]ACTION_CANCEL/)
    assert.match(unitTestSource, /acceptsOnlyBoundedCredentialFreeHttpUrls/)
    assert.match(unitTestSource, /requiresManifestAndPackageContentForApkDetection/)
    assert.match(unitTestSource, /fingerprintsCanonicalQueryUrlsDeterministically/)
    assert.match(unitTestSource, /validatesMediaBridgeTokens/)
  })

  test('adds the shared MIME detector dependency idempotently', () => {
    const buildGradle = 'dependencies {\n}'
    const configured = downloadsPlugin.addSimpleMagicDependency(buildGradle)

    assert.match(
      configured,
      /implementation\("com[.]j256[.]simplemagic:simplemagic:1[.]17"\)/
    )
    assert.match(configured, /testImplementation\("junit:junit:4[.]13[.]2"\)/)
    assert.equal(downloadsPlugin.addSimpleMagicDependency(configured), configured)
  })

  test('renders complete Android sources from the tracked templates', () => {
    const packageName = 'xyz.p2plabs.peersky'
    const sources = [
      downloadsPlugin.createDownloadsModule(packageName),
      downloadsPlugin.createDownloadsPackage(packageName),
      downloadsPlugin.createWebViewManager(packageName),
      downloadsPlugin.createDownloadsModuleTest(packageName)
    ]

    sources.forEach((source) => {
      assert.match(source, /^package xyz[.]p2plabs[.]peersky/m)
      assert.doesNotMatch(source, /__PACKAGE_NAME__/)
    })
  })

  test('uses the PeerSky Android WebView download manager', () => {
    const indexSource = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')
    const nativeConfigSource = readFileSync(
      new URL('../../app/downloads/PeerSkyWebView.ts', import.meta.url),
      'utf8'
    )

    assert.match(indexSource, /nativeConfig=\{browserNativeConfig\}/)
    assert.match(nativeConfigSource, /requireNativeComponent/)
    assert.match(nativeConfigSource, /PeerSkyWebView/)
    assert.match(nativeConfigSource, /hasViewManagerConfig/)
  })
})
