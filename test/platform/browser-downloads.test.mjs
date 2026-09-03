import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { createRequire } from 'node:module'
import {
  addDownloadUrlFingerprint,
  findCompletedHyperDownload,
  getProxiedHyperUrl,
  MAX_BROWSER_DOWNLOADS,
  createUniqueDownloadFilename,
  normalizeBrowserDownloads,
  normalizeBrowserDownloadUrl,
  sortBrowserDownloads
} from '../../app/downloads/browser-downloads.mjs'

const require = createRequire(import.meta.url)
const downloadsPlugin = require('../../plugins/with-browser-downloads')

describe('browser downloads', () => {
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
    assert.match(moduleSource, /fun requestDownload\(url: String, promise: Promise\)/)
    assert.match(moduleSource, /sourceUrl = url/)
    assert.match(moduleSource, /record[.]putString\("sourceUrl", it\)/)
    assert.match(moduleSource, /promise[.]resolve\(queueDownload\(url, null, null, null\)\)/)
    assert.match(moduleSource, /fun openDownload\(id: String, promise: Promise\)/)
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
    assert.match(moduleSource, /packageManager[.]canRequestPackageInstalls\(\)/)
    assert.match(moduleSource, /Settings[.]ACTION_MANAGE_UNKNOWN_APP_SOURCES/)
    assert.match(moduleSource, /resolveMimeTypeFromFilename\(download[.]name, download[.]mimeType\)/)
    assert.doesNotMatch(moduleSource, /manager[.]remove\(downloadId\).*user-paused/s)
    assert.match(moduleSource, /getSharedPreferences/)
    assert.match(packageSource, /listOf\(PeerSkyWebViewManager\(\)\)/)
    assert.match(webViewManagerSource, /setDownloadListener/)
    assert.match(webViewManagerSource, /queueDownload/)
    assert.match(webViewManagerSource, /Download service is unavailable[.]/)
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
