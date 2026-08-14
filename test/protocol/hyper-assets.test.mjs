import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_INLINE_ASSET_BYTES,
  MAX_INLINE_STYLESHEET_BYTES,
  createDownloadContentDisposition,
  createProxyAssetUrl,
  getContentTypeFromUrl,
  getInlineAssetByteLimit,
  headersToObject,
  isMalformedRangeHeader,
  normalizeDownloadFilename,
  resolveHyperAssetUrl,
  rewriteHyperAssetAttributes,
  rewriteHyperDownloadAttributes,
  rewriteHyperMediaAttributes,
  shouldInlineAsset,
  shouldProxyMediaAsset
} from '../../backend/hyper/assets.mjs'

const baseUrl = 'hyper://example.com/docs/index.html'
const assetAuthToken = 'test-hyper-asset-token-0123456789abcdef'

test('resolves only safe hyper asset URLs', () => {
  assert.equal(resolveHyperAssetUrl('./style.css', baseUrl), 'hyper://example.com/docs/style.css')
  assert.equal(resolveHyperAssetUrl('/logo.png', baseUrl), 'hyper://example.com/logo.png')
  assert.equal(resolveHyperAssetUrl('hyper://other.com/app.js', baseUrl), 'hyper://other.com/app.js')
  assert.equal(resolveHyperAssetUrl('#section', baseUrl), null)
  assert.equal(resolveHyperAssetUrl('https://example.com/style.css', baseUrl), null)
  assert.equal(resolveHyperAssetUrl('//example.com/style.css', baseUrl), null)
  assert.equal(resolveHyperAssetUrl('javascript:alert(1)', baseUrl), null)
  assert.equal(resolveHyperAssetUrl('data:text/plain,hello', baseUrl), null)
})

test('classifies inline assets separately from streamable media assets', () => {
  assert.equal(shouldInlineAsset('style.css', 'hyper://example.com/style.css'), true)
  assert.equal(shouldInlineAsset('logo.svg', 'hyper://example.com/logo.svg'), true)
  assert.equal(shouldInlineAsset('clip.mp4', 'hyper://example.com/clip.mp4'), false)

  assert.equal(shouldProxyMediaAsset('clip.mp4', 'hyper://example.com/clip.mp4'), true)
  assert.equal(shouldProxyMediaAsset('audio.ogg?download=1', 'hyper://example.com/audio.ogg?download=1'), true)
  assert.equal(shouldProxyMediaAsset('style.css', 'hyper://example.com/style.css'), false)
})

test('rewrites hyper media references to the local streaming proxy', () => {
  const assetBaseUrl = 'http://127.0.0.1:45123'
  const html = '<video src="./clip.mp4" poster="./poster.png"></video><a href="./song.mp3">play</a><img src="./logo.png">'
  const rewritten = rewriteHyperMediaAttributes(html, baseUrl, assetBaseUrl, assetAuthToken)

  assert.match(rewritten, /<video src="http:\/\/127\.0\.0\.1:45123\/asset\?token=test-hyper-asset-token-0123456789abcdef&url=hyper%3A%2F%2Fexample\.com%2Fdocs%2Fclip\.mp4" poster="\.\/poster\.png"><\/video>/)
  assert.match(rewritten, /<a href="http:\/\/127\.0\.0\.1:45123\/asset\?token=test-hyper-asset-token-0123456789abcdef&url=hyper%3A%2F%2Fexample\.com%2Fdocs%2Fsong\.mp3">play<\/a>/)
  assert.match(rewritten, /<img src="\.\/logo\.png">/)
})

test('builds encoded proxy asset URLs', () => {
  assert.equal(
    createProxyAssetUrl('http://127.0.0.1:3000', 'hyper://example.com/video.mp4?x=1', assetAuthToken),
    'http://127.0.0.1:3000/asset?token=test-hyper-asset-token-0123456789abcdef&url=hyper%3A%2F%2Fexample.com%2Fvideo.mp4%3Fx%3D1'
  )
})

test('rewrites explicit hyper downloads to the local streaming proxy', () => {
  const html = '<a download="report.pdf" href="./files/report.pdf">Download</a><a download href=./plain.txt>Plain</a><a href="./page.html">Page</a>'
  const rewritten = rewriteHyperDownloadAttributes(html, baseUrl, 'http://127.0.0.1:45123', assetAuthToken)

  assert.match(rewritten, /href="http:\/\/127\.0\.0\.1:45123\/asset\?token=test-hyper-asset-token-0123456789abcdef&url=hyper%3A%2F%2Fexample\.com%2Fdocs%2Ffiles%2Freport\.pdf&download=1&name=report\.pdf"/)
  assert.match(rewritten, /href=http:\/\/127\.0\.0\.1:45123\/asset\?token=test-hyper-asset-token-0123456789abcdef&url=hyper%3A%2F%2Fexample\.com%2Fdocs%2Fplain\.txt&download=1/)
  assert.match(rewritten, /<a href="\.\/page\.html">Page<\/a>/)
})

test('does not mistake download text or prefixed attributes for download links', () => {
  const html = [
    '<a href="./download/report.pdf">Path</a>',
    '<a data-download href="./data.pdf">Data attribute</a>',
    '<a aria-label="download file" href="./label.pdf">Label</a>',
    '<a title="please download file" href="./title.pdf">Title</a>'
  ].join('')

  assert.equal(
    rewriteHyperDownloadAttributes(html, baseUrl, 'http://127.0.0.1:45123', assetAuthToken),
    html
  )
})

test('preserves explicit image downloads before generic asset inlining', () => {
  const downloadsRewritten = rewriteHyperDownloadAttributes(
    '<a download="photo.png" href="./photo.png">Photo</a>',
    baseUrl,
    'http://127.0.0.1:45123',
    assetAuthToken
  )
  const rewritten = rewriteHyperAssetAttributes(
    downloadsRewritten,
    baseUrl,
    new Map([['./photo.png', 'data:image/png;base64,aW1hZ2U=']])
  )

  assert.match(rewritten, /href="http:\/\/127\.0\.0\.1:45123\/asset\?/)
  assert.doesNotMatch(rewritten, /data:image/)
})

test('sanitizes proxied download filenames', () => {
  assert.equal(normalizeDownloadFilename('../bad"name.txt', 'hyper://example.com/fallback.txt'), '.._bad_name.txt')
  assert.equal(normalizeDownloadFilename('', 'hyper://example.com/report.pdf'), 'report.pdf')
  assert.ok(Buffer.byteLength(normalizeDownloadFilename('\u{1F600}'.repeat(100), ''), 'utf8') <= 255)
})

test('builds ASCII-safe content disposition with an RFC 5987 Unicode name', () => {
  const disposition = createDownloadContentDisposition('report-\u{1F600}.pdf')

  assert.equal(
    disposition,
    'attachment; filename="report-_.pdf"; filename*=UTF-8\'\'report-%F0%9F%98%80.pdf'
  )
  assert.equal(/^[\x20-\x7e]+$/.test(disposition), true)
})

test('validates byte range headers before proxying media', () => {
  assert.equal(isMalformedRangeHeader(null), false)
  assert.equal(isMalformedRangeHeader('bytes=0-'), false)
  assert.equal(isMalformedRangeHeader('bytes=0-1024'), false)
  assert.equal(isMalformedRangeHeader('bytes=-1024'), false)

  assert.equal(isMalformedRangeHeader('bytes='), true)
  assert.equal(isMalformedRangeHeader('items=0-1'), true)
  assert.equal(isMalformedRangeHeader('bytes=a-b'), true)
  assert.equal(isMalformedRangeHeader('bytes=0-1,2-3'), true)
})

test('uses larger inline limit for stylesheets only', () => {
  assert.equal(getInlineAssetByteLimit('hyper://example.com/app.css', ''), MAX_INLINE_STYLESHEET_BYTES)
  assert.equal(getInlineAssetByteLimit('hyper://example.com/app.bin', 'text/css'), MAX_INLINE_STYLESHEET_BYTES)
  assert.equal(getInlineAssetByteLimit('hyper://example.com/logo.png', 'image/png'), MAX_INLINE_ASSET_BYTES)
})

test('normalizes iterable headers to lower-case object keys', () => {
  assert.deepEqual(
    headersToObject([
      ['Content-Type', 'video/mp4'],
      ['Accept-Ranges', 'bytes']
    ]),
    {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes'
    }
  )
})

test('detects content types for common hyper assets', () => {
  assert.equal(getContentTypeFromUrl('hyper://example.com/site.css'), 'text/css; charset=utf-8')
  assert.equal(getContentTypeFromUrl('hyper://example.com/app.js'), 'text/javascript; charset=utf-8')
  assert.equal(getContentTypeFromUrl('hyper://example.com/movie.mp4'), 'video/mp4')
  assert.equal(getContentTypeFromUrl('hyper://example.com/unknown.bin'), 'application/octet-stream')
})
