import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

import {
  describeTooManyFiles,
  isTooManyFiles,
  isUsableImageType,
  sniffBase64ImageType,
  MAX_UPLOAD_BATCH,
  MEDIA_ALLOWED,
  MEDIA_BLOCKED,
  MEDIA_UNSCANNED,
  normalizeMediaVerdict,
  screenUploadBatch,
  verdictFromPredictions,
  videoSampleTimes
} from '../../app/media/media-moderation.mjs'

test('media screening refuses a photo however the model divides up its score', () => {
  const at = (scores) => Object.entries(scores).map(([className, probability]) => ({ className, probability }))

  assert.equal(verdictFromPredictions(at({ Porn: 0.97, Neutral: 0.03 })), MEDIA_BLOCKED)
  assert.equal(verdictFromPredictions(at({ Hentai: 0.8, Neutral: 0.2 })), MEDIA_BLOCKED)

  // Nudity usually lands here, which is most of what actually gets posted.
  assert.equal(verdictFromPredictions(at({ Sexy: 0.85, Neutral: 0.15 })), MEDIA_BLOCKED)

  // The case that made this necessary: a split where no single class looks
  // decisive on its own but the photo is plainly not safe.
  assert.equal(verdictFromPredictions(at({ Porn: 0.3, Sexy: 0.45, Neutral: 0.25 })), MEDIA_BLOCKED)
  assert.equal(verdictFromPredictions(at({ Porn: 0.25, Hentai: 0.25, Neutral: 0.5 })), MEDIA_BLOCKED)

  // Ordinary photos still go through, including a beach photo that scores some
  // Sexy without being nudity.
  assert.equal(verdictFromPredictions(at({ Neutral: 0.99, Sexy: 0.01 })), MEDIA_ALLOWED)
  assert.equal(verdictFromPredictions(at({ Sexy: 0.5, Neutral: 0.45, Drawing: 0.05 })), MEDIA_ALLOWED)
})

test('media screening says nothing rather than allowing when it has nothing to go on', () => {
  assert.equal(verdictFromPredictions([]), MEDIA_UNSCANNED)
  assert.equal(verdictFromPredictions(null), MEDIA_UNSCANNED)
  assert.equal(normalizeMediaVerdict('clean'), MEDIA_UNSCANNED)
})

test('one refused file stops the whole batch', () => {
  const ok = [{ fileName: 'a.png', verdict: MEDIA_ALLOWED }, { fileName: 'b.png', verdict: MEDIA_UNSCANNED }]
  assert.equal(screenUploadBatch(ok).allowed, true)

  const decision = screenUploadBatch([...ok, { fileName: 'c.png', verdict: MEDIA_BLOCKED }])
  assert.equal(decision.allowed, false)
  assert.match(decision.reason, /c\.png/)
})

test('a send carries a bounded number of files', () => {
  assert.equal(isTooManyFiles(MAX_UPLOAD_BATCH), false)
  assert.equal(isTooManyFiles(MAX_UPLOAD_BATCH + 1), true)
  assert.match(describeTooManyFiles(40), new RegExp(String(MAX_UPLOAD_BATCH)))
})

test('a video is sampled away from its first and last frame', () => {
  const times = videoSampleTimes(60, 4)
  assert.equal(times.length, 4)
  assert.ok(times[0] > 0, 'a clip that opens on black tells you nothing')
  assert.ok(times.at(-1) < 60, 'nor does the cut at the end')
  assert.equal(videoSampleTimes(2, 8).length, 2)
  assert.deepEqual(videoSampleTimes(0), [0])
})

test('every upload in the app goes through the one gate', async () => {
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')

  // Screen the whole batch, then upload. Uploading as we go would leave half a
  // send behind when the third file is refused.
  const screenAt = gate.indexOf('screenUploadBatch')
  assert.ok(screenAt > -1)
  assert.match(gate, /if \(!decision\.allowed\) throw new Error\(decision\.reason\)/)

  // A classifier that fell over must not read as cleared.
  assert.match(gate, /catch \{[\s\S]{0,200}return MEDIA_UNSCANNED/)

  for (const [file, label] of [
    ['../../app/peerchat/PeerChatScreen.tsx', 'PeerChat attachments'],
    ['../../app/hyperdrive/HyperdriveScreen.tsx', 'Hyperdrive uploads']
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /pickUploads\(/, `${label} must use the gate`)
    // The raw picker is the way around it, so nothing may still reach for it.
    assert.doesNotMatch(source, /DocumentPicker\.getDocumentAsync/, `${label} still calls the picker directly`)
  }

  // P2PMD's images arrive as base64 from a WebView, with no file to point at.
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const upload = app.slice(app.indexOf('async function uploadP2pmdImage'), app.indexOf('function resolveP2pmdBridgeRequest'))
  assert.match(upload, /await screenUploadBytes\(/)
  const screenAtP2pmd = upload.indexOf('screenUploadBytes')
  assert.ok(upload.indexOf('RPC_P2PMD_IMAGE_UPLOAD') > screenAtP2pmd, 'the screen must come before the upload')
})

test('the classifier page answers tfjs out of memory instead of the network', async () => {
  const { buildNsfwScannerPage, NSFW_MODEL_URL, NSFW_WEIGHTS_NAME } =
    await import('../../app/media/nsfw-scanner-page.mjs')

  const page = buildNsfwScannerPage({
    library: 'window.nsfwjs = { load: function () {} }',
    modelJson: '{"modelTopology":{}}',
    weightsBase64: 'AAAA'
  })

  // The library has to exist before the script that calls into it.
  assert.ok(page.indexOf('window.nsfwjs = ') < page.indexOf('window.nsfwjs.load'))

  // tfjs fetches model.json and then the shard its manifest names. There is no
  // server here, so both are answered from memory and everything else refused.
  assert.match(page, /window\.fetch = function/)
  assert.ok(page.includes(NSFW_MODEL_URL))
  assert.ok(page.includes(NSFW_WEIGHTS_NAME))
  assert.match(page, /return Promise\.reject\(new Error\('blocked: '/)

  // Nothing in the page may reach the open web.
  const inline = page.replace(/window\.nsfwjs = [^\n]*/g, '')
  assert.doesNotMatch(inline, /https?:\/\/(?!peersky\.local)/)
})

test('a classifier that cannot answer never clears an upload', async () => {
  const host = await readFile(new URL('../../app/media/NsfwScanner.tsx', import.meta.url), 'utf8')

  // Timeout, oversized file, unreadable picture, missing WebView, wrong type:
  // every one of them is unscanned, never allowed.
  for (const guard of [
    /if \(declared\.startsWith\('video\/'\).*\) return MEDIA_UNSCANNED/,
    /if \(!base64\) return MEDIA_UNSCANNED/,
    /if \(!asset\.base64\) return MEDIA_UNSCANNED/,
    /if \(\(asset\.size \?\? 0\) > MAX_SCANNED_BYTES\) return MEDIA_UNSCANNED/,
    /if \(!liveWebView\) return MEDIA_UNSCANNED/,
    /resolve\(MEDIA_UNSCANNED\)\n {4}\}, SCAN_TIMEOUT_MS\)/,
    /message\.error \? MEDIA_UNSCANNED : verdictFromPredictions/
  ]) {
    assert.match(host, guard)
  }

  // A file the decoder cannot open is a file it cannot judge.
  assert.match(host, /catch \{[\s\S]{0,160}return MEDIA_UNSCANNED/)
  // A re-encode that produced nothing is not a clean picture either.
  assert.match(host, /if \(!base64\) return MEDIA_UNSCANNED/)

  // Off screen, not hidden: both platforms pause a hidden WebView and it would
  // never answer.
  assert.match(host, /position: 'absolute'/)
  assert.doesNotMatch(host, /display: 'none'/)
})

test('the classifier assets stay on an extension Metro already resolves', async () => {
  const host = await readFile(new URL('../../app/media/NsfwScanner.tsx', import.meta.url), 'utf8')
  const metro = await readFile(new URL('../../metro.config.js', import.meta.url), 'utf8')

  // A new assetExt means a resolver change, and a Metro that has not been
  // restarted then fails the build outright rather than falling back.
  const required = [...host.matchAll(/assets\/nsfw\/([\w.-]+)/g)].map((match) => match[1])
  assert.equal(required.length, 2)
  for (const name of required) {
    assert.ok(name.endsWith('.txt'), `${name} needs an extension Metro already treats as an asset`)
    assert.match(metro, /assetExts\.push\('txt'/)
  }

  for (const name of required) {
    const asset = await stat(new URL(`../../assets/nsfw/${name}`, import.meta.url))
    assert.ok(asset.size > 1000, `${name} is missing or empty`)
  }
})

test('a file pick abandoned by leaving the app does not wedge the screen', async () => {
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')

  // The picker's result never arrives if the app was killed while it was open,
  // so the promise stays pending and whatever awaited it stays busy forever.
  // That is what hides the attach button behind its own spinner.
  assert.match(gate, /abandonPick = \(\) => resolve\(null\)/)
  assert.match(gate, /state !== 'active'/)
  assert.match(gate, /abandonPick = null/)

  // Coming back from a pick that did work also fires active, a moment before
  // the result lands, so there has to be a grace period between the two.
  assert.match(gate, /setTimeout\([\s\S]{0,120}ABANDONED_PICK_GRACE_MS\)/)
  const grace = gate.match(/ABANDONED_PICK_GRACE_MS = (\d+)/)
  assert.ok(grace && Number(grace[1]) >= 1000, 'too short and a real pick gets thrown away')

  // Android rejects a second pick outright; the user can do nothing with that.
  assert.match(gate, /document picking in progress/i)
  assert.match(gate, /if \(abandonPick\) return null/)
})

test('the classifier page is served from a file and says whether it started', async () => {
  const host = await readFile(new URL('../../app/media/NsfwScanner.tsx', import.meta.url), 'utf8')

  // A six megabyte page handed over as a prop is slow on iOS and silently
  // fails on Android, so the files are staged on disk and pulled in with
  // script tags. Nothing large may be built in JavaScript.
  assert.match(host, /source=\{source\}/)
  assert.doesNotMatch(host, /source=\{\{ html/)
  assert.match(host, /allowFileAccess/)
  assert.match(host, /allowingReadAccessToURL/)
  assert.match(host, /\.copy\(target\)/)

  const page = await readFile(new URL('../../app/media/nsfw-scanner-page.mjs', import.meta.url), 'utf8')
  // A file:// page cannot fetch its own siblings on iOS, so the model has to
  // arrive as a script that assigns globals.
  assert.match(page, /<script src="\.\/\$\{NSFW_MODEL_FILE\}"><\/script>/)
  assert.match(page, /<script src="\.\/\$\{NSFW_LIBRARY_FILE\}"><\/script>/)
  assert.match(page, /classifier files did not load/)

  // Without this a classifier that never started looks exactly like a clean
  // picture: silence, and every upload waved through.
  assert.match(host, /if \(message\.ready !== undefined\)/)
  assert.match(host, /classifier failed to start/)
  assert.match(host, /onError=/)
})

test('a refused upload stays on screen long enough to read', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  // A refresh clears the error, and refreshes now arrive the moment anything
  // changes, so the message was gone in about a second.
  const floor = screen.match(/ERROR_MIN_VISIBLE_MS = (\d+)/)
  assert.ok(floor && Number(floor[1]) >= 5000, 'a refused upload has to be readable')
  assert.match(screen, /function clearReadError \(\)/)
  assert.match(screen, /Date\.now\(\) - errorShownAtRef\.current < ERROR_MIN_VISIBLE_MS/)

  // The refresh path must go through the guarded clear, not setError(null).
  const refresh = screen.slice(screen.indexOf('const refreshRoom = useCallback'), screen.indexOf('pollInFlightRef.current = false'))
  assert.match(refresh, /clearReadError\(\)/)
  assert.doesNotMatch(refresh, /setError\(null\)/)
})

test('what arrives is screened too, not only what is sent', async () => {
  const host = await readFile(new URL('../../app/media/NsfwScanner.tsx', import.meta.url), 'utf8')
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  // One scan core, reachable from both directions. A peer running a modified
  // build is exactly why the receiving side has to have its own say.
  assert.match(host, /export async function scanMedia \(/)
  assert.match(host, /setUploadScanner\(\(asset: UploadAsset\) => scanMedia\(asset\)\)/)

  const attachment = screen.slice(screen.indexOf('const [isExplicit'), screen.indexOf('if (mediaUrl && mediaKind === \'image\')'))
  assert.match(attachment, /void scanMedia\(\{ uri: mediaUrl/)
  // Your own upload was already screened on the way out.
  assert.match(attachment, /if \(!mediaUrl \|\| item\.self \|\| mediaKind !== 'image'\) return/)

  // The picture must not render while the verdict is still outstanding.
  assert.match(screen, /if \(mediaUrl && mediaKind === 'image' && \(isScreening \|\| isExplicit\)\)/)
  assert.match(screen, /Hidden: this looks explicit/)
})

test('an attachment upload can never lock the composer forever', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  // The upload streams and normally replies, but a stall must not leave the
  // composer stuck busy for the rest of the session.
  assert.match(screen, /function withUploadTimeout /)
  assert.match(screen, /Promise\.race\(/)
  assert.match(screen, /withUploadTimeout\(callRpc\(RPC_PEERCHAT_ATTACHMENT_UPLOAD/)

  // Generous, so a legitimately slow large video is not cut off.
  const timeout = screen.match(/UPLOAD_TIMEOUT_MS = ([^\n]+)/)
  assert.ok(timeout)
  // eslint-disable-next-line no-new-func
  assert.ok(Function(`return (${timeout[1]})`)() >= 120000, 'too short would cut a real upload')
})

test('the media viewer close button clears the Dynamic Island', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const viewer = screen.slice(screen.indexOf('function PeerChatMediaViewer'), screen.indexOf('function AttachmentCaption'))

  // A Modal is its own root view on iOS, so a bare SafeAreaView inside it
  // reports zero top inset and the close button lands under the island.
  assert.match(viewer, /<SafeAreaProvider initialMetrics=\{initialWindowMetrics\}>/)
  assert.match(viewer, /edges=\{\['top', 'bottom', 'left', 'right'\]\}/)
})

test('the real image type is read off the bytes when nobody declares one', () => {
  // Verified against real byte sequences, not guessed.
  const samples = {
    'image/png': 'iVBORw0KGgoAAAAN',
    'image/jpeg': '/9j/4AAQSkZJRgAB',
    'image/gif': 'R0lGODdhLi4uLg==',
    'image/webp': 'UklGRgAAAABXRUJQ'
  }
  for (const [expected, base64] of Object.entries(samples)) {
    assert.equal(sniffBase64ImageType(base64), expected)
  }
  assert.equal(sniffBase64ImageType('R0lGODlhLi4uLg=='), 'image/gif')
  assert.equal(sniffBase64ImageType('bm90IGFuIGltYWdl'), '')
  assert.equal(sniffBase64ImageType(''), '')
})

test('a wildcard type is not a type anything can decode', () => {
  // 'image/*' passes a naive startsWith check, builds data:image/*;base64,...,
  // fails to decode, and the picture reads as clean. That is how P2PMD uploads
  // were getting through.
  assert.equal(isUsableImageType('image/*'), false)
  assert.equal(isUsableImageType(''), false)
  assert.equal(isUsableImageType('video/mp4'), false)
  assert.equal(isUsableImageType('image/png'), true)
})

test('P2PMD images are screened with a type the decoder accepts', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const upload = app.slice(app.indexOf('async function uploadP2pmdImage'), app.indexOf('function resolveP2pmdBridgeRequest'))

  // P2PMD sends bare base64 with no type at all.
  assert.match(upload, /isUsableImageType\(declared\) \? declared : sniffBase64ImageType\(base64\)/)
  // Anchor on code, not prose: the comment explains the wildcard it replaced.
  const code = upload.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /'image\/\*'/)
  assert.ok(upload.indexOf('screenUploadBytes') < upload.indexOf('RPC_P2PMD_IMAGE_UPLOAD'))
})

test('bytes with no file behind them are shrunk before they cross the bridge', async () => {
  const host = await readFile(new URL('../../app/media/NsfwScanner.tsx', import.meta.url), 'utf8')
  const fn = host.slice(host.indexOf('export async function scanMedia ('), host.indexOf('async function stageScannerFiles'))

  // P2PMD hands over a whole photo as base64. Posting that at full size took
  // longer than the scan timeout, and a timeout counts as unscanned, so the
  // picture went up unchecked. Bytes are written to a scratch file so they go
  // through the same resize every picked file does.
  assert.match(fn, /scratch\.write\(asset\.base64, \{ encoding: 'base64' \}\)/)
  assert.ok(fn.indexOf('scratch.write') < fn.indexOf('ImageManipulator.manipulate'))

  // One resize, one format, one code path. Nothing reaches the classifier at
  // its original size any more.
  assert.equal(fn.match(/ImageManipulator\.manipulate/g).length, 1)
  assert.match(fn, /\.resize\(\{ width: NSFW_INPUT_SIZE \}\)/)
  assert.match(fn, /dataUrl: `data:image\/jpeg;base64,\$\{base64\}`/)

  // The scratch file is temporary, not something left behind on the phone.
  assert.match(fn, /scratch\?\.delete\(\)/)

  // Video is turned away up front, so a large clip is never decoded.
  assert.ok(fn.indexOf("declared.startsWith('video/')") < fn.indexOf('ImageManipulator.manipulate'))
})

test('a P2PMD photo is measured by its real size, not its base64 length', async () => {
  const app = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')
  const upload = app.slice(app.indexOf('async function uploadP2pmdImage'), app.indexOf('function resolveP2pmdBridgeRequest'))

  // Base64 runs a third longer than the bytes it carries. Passing the string
  // length made a large photo look bigger than the scan limit, so it skipped
  // the check on a size it had not actually reached.
  assert.match(upload, /size: Math\.floor\(\(base64\.length \* 3\) \/ 4\)/)
  assert.doesNotMatch(upload, /size: base64\.length/)
})

test('a folder upload screens every file in it before any of them go', async () => {
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')
  const fn = gate.slice(gate.indexOf('export async function pickUploadFolder'), gate.indexOf('* The one place every upload'))

  // Same rule as a hand-picked batch: screen everything, then decide once.
  assert.ok(fn.indexOf('scanAsset(asset)') < fn.indexOf('screenUploadBatch(screened)'))
  assert.match(fn, /if \(!decision\.allowed\)/)
  assert.match(fn, /throw new Error\(decision\.reason\)/)

  // A refused folder must not leave its staged copies behind.
  const refusal = fn.slice(fn.indexOf('if (!decision.allowed)'))
  assert.match(refusal, /staging\.delete\(\)/)
})

test('a folder walk is bounded in both depth and count', async () => {
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')

  const files = gate.match(/MAX_FOLDER_FILES = (\d+)/)
  const depth = gate.match(/MAX_FOLDER_DEPTH = (\d+)/)
  assert.ok(files && Number(files[1]) > 0 && Number(files[1]) <= 200, 'an unbounded folder would screen forever')
  assert.ok(depth && Number(depth[1]) > 0 && Number(depth[1]) <= 10, 'a pathological tree must not walk forever')

  // Both limits are actually enforced in the walk, not just declared.
  const walk = gate.slice(gate.indexOf('function collectFiles'), gate.indexOf('export async function pickUploadFolder'))
  assert.match(walk, /depth > MAX_FOLDER_DEPTH \|\| into\.length >= MAX_FOLDER_FILES/)
  assert.match(walk, /if \(into\.length >= MAX_FOLDER_FILES\) return/)
  // A zero byte entry breaks the backend size guard.
  assert.match(walk, /\(entry\.size \?\? 0\) > 0/)
})

test('the backend opens staged folder files and nothing else', async () => {
  const library = await readFile(new URL('../../backend/hyper/library.mjs', import.meta.url), 'utf8')
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')

  // The originals live outside the sandbox, and on Android behind a content
  // uri the backend cannot open, so a folder stages its files first.
  const staging = gate.match(/STAGING_FOLDER = '([\w-]+)'/)
  assert.ok(staging)
  assert.ok(library.includes(`documentpicker|${staging[1]}`), 'the backend must accept the staging folder')

  // And still nothing outside those two.
  assert.match(library, /parsed\.protocol !== 'file:'/)
  assert.match(library, /segment === '\.\.'/)
})

test('Hyperdrive routes a folder through the same gate as files', async () => {
  const screen = await readFile(new URL('../../app/hyperdrive/HyperdriveScreen.tsx', import.meta.url), 'utf8')
  const upload = screen.slice(screen.indexOf('async function uploadFile ('), screen.indexOf('async function fetchLocation'))

  assert.match(upload, /source === 'folder' \? await pickUploadFolder\(\) : await pickUploads/)
  // Never the raw picker, which would skip the screen.
  assert.doesNotMatch(screen, /DocumentPicker\.getDocumentAsync/)
})

test('the classifier is staged fresh, so a bad copy cannot outlive a fix', async () => {
  const host = await readFile(new URL('../../app/media/NsfwScanner.tsx', import.meta.url), 'utf8')
  const fn = host.slice(host.indexOf('async function stageScannerFiles'), host.indexOf('export function NsfwScanner'))

  // Keeping whatever was already there meant a truncated copy from an earlier
  // build survived forever and no fix could take effect.
  assert.match(fn, /if \(folder\.exists\) folder\.delete\(\)/)
  assert.doesNotMatch(fn, /if \(target\.exists\) continue/)

  // And a copy that did not land must be loud, not silently unscreened.
  assert.match(fn, /did not stage/)
})

test('a picked folder survives Android content uris', async () => {
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')
  const fn = gate.slice(gate.indexOf('export async function pickUploadFolder'), gate.indexOf('* The one place every upload'))

  // copy() refuses a content:// uri outright, which is how every folder upload
  // on Android died. Reading the bytes goes through the same provider.
  assert.match(fn, /source\.copy\(target\)/)
  assert.match(fn, /target\.write\(await source\.bytes\(\)\)/)
  assert.ok(fn.indexOf('source.copy(target)') < fn.indexOf('await source.bytes()'), 'copy is tried first')
})

test('every storage choice is reachable on Android', async () => {
  const screen = await readFile(new URL('../../app/hyperdrive/HyperdriveScreen.tsx', import.meta.url), 'utf8')
  const fn = screen.slice(screen.indexOf('function chooseUploadVisibility'), screen.indexOf('async function uploadFile'))

  // Android renders at most three Alert buttons and drops the rest, which is
  // why Public never appeared there.
  assert.match(fn, /Platform\.OS === 'android' \? \[\] :/)
  assert.match(fn, /cancelable: true/)
  for (const option of ['private', 'device', 'public']) {
    assert.ok(fn.includes(`uploadFile('${option}'`), `${option} must be offered`)
  }
})

test('the classifier is not torn down by the parent re-rendering', async () => {
  const host = await readFile(new URL('../../app/media/NsfwScanner.tsx', import.meta.url), 'utf8')

  // App re-renders on every PeerChat change. A fresh {uri} object each time is
  // a new source to the WebView, which reloads the page and orphans whatever
  // scan is in flight until it times out as unscanned.
  assert.match(host, /export const NsfwScanner = memo\(/)
  assert.match(host, /const source = useMemo\(\(\) => \(\{ uri: pageUri \|\| '' \}\), \[pageUri\]\)/)
  assert.match(host, /source=\{source\}/)
  assert.doesNotMatch(host, /source=\{\{ uri: pageUri \}\}/)
})

test('video is never put through the image screen', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  // There is no frame decoder here, so a video always came back unscanned.
  // Worse, flipping isScreening rebuilt the video player mid-render and the
  // native object was already released.
  assert.match(screen, /item\.self \|\| mediaKind !== 'image'\) return/)
  assert.match(screen, /mediaKind === 'image' && \(isScreening \|\| isExplicit\)/)
  assert.doesNotMatch(screen, /mediaKind && \(isScreening \|\| isExplicit\)/)
})
