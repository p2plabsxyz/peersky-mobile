import { Asset } from 'expo-asset'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { Directory, File, Paths } from 'expo-file-system'
import { memo, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import WebView from 'react-native-webview'

import {
  buildNsfwScannerPage,
  NSFW_INPUT_SIZE,
  NSFW_LIBRARY_FILE,
  NSFW_MODEL_FILE,
  NSFW_PAGE_FILE
} from './nsfw-scanner-page.mjs'
import {
  MEDIA_UNSCANNED,
  verdictFromPredictions
} from './media-moderation.mjs'
import { setUploadScanner, type UploadAsset } from './upload-gate'

// A phone should not be stuck on a picture that will not decode. The gate
// treats a timeout as unscanned, the same as a classifier that fell over.
const SCAN_TIMEOUT_MS = 20_000
// Above this it is almost certainly not a photo a canvas can take, and pushing
// tens of megabytes of base64 across the bridge would stall the app.
const MAX_SCANNED_BYTES = 24 * 1024 * 1024

type ScannerStatus = 'starting' | 'ready' | 'unavailable'

// Read by the settings screen so the state is visible rather than guessed at.
let currentStatus: ScannerStatus = 'starting'
const statusListeners = new Set<(status: ScannerStatus) => void>()

export function getMediaScannerStatus () {
  return currentStatus
}

export function onMediaScannerStatus (listener: (status: ScannerStatus) => void) {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

function setStatus (next: ScannerStatus) {
  currentStatus = next
  for (const listener of statusListeners) listener(next)
}

type Pending = {
  resolve: (verdict: string) => void
  timer: ReturnType<typeof setTimeout>
}

// Module scope on purpose. The send path screens what you are about to upload
// and the receive path screens what arrived, and a peer running a modified
// build is exactly why the second one has to exist. Both go through here.
let liveWebView: WebView | null = null
const pending = new Map<string, Pending>()
let nextId = 0

function settle (id: string, verdict: string) {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.resolve(verdict)
}

export async function scanMedia (asset: {
  uri?: string
  base64?: string
  mimeType?: string
  size?: number
}) {
  // Video needs frames pulled out of it, which needs a decoder this does not
  // have yet. Pictures are what actually get posted.
  const declared = asset.mimeType || ''
  if (declared.startsWith('video/') || declared === 'image/svg+xml') return MEDIA_UNSCANNED
  if ((asset.size ?? 0) > MAX_SCANNED_BYTES) return MEDIA_UNSCANNED
  if (!liveWebView) return MEDIA_UNSCANNED

  // Everything goes through the decoder, whether it arrived as a file or as
  // bare bytes. Two reasons. It normalises whatever the platform can open into
  // one JPEG, so an iPhone's HEIC is judged instead of waved through. And it
  // shrinks the picture to the size the model wants before anything crosses
  // the bridge.
  //
  // That second part is what P2PMD was failing on. Its editor hands over a
  // whole photo as base64, and posting megabytes of it took longer than the
  // scan timeout, which reads as unscanned and lets the picture through. A
  // picked file was always resized first, which is why PeerChat looked fine
  // while P2PMD did not.
  let scratch: File | null = null
  let base64 = ''
  try {
    let sourceUri = asset.uri || ''
    if (!sourceUri) {
      if (!asset.base64) return MEDIA_UNSCANNED
      scratch = new File(Paths.cache, `nsfw-scan-${Date.now().toString(36)}-${++nextId}`)
      if (scratch.exists) scratch.delete()
      scratch.create()
      scratch.write(asset.base64, { encoding: 'base64' })
      sourceUri = scratch.uri
    }
    const rendered = await ImageManipulator.manipulate(sourceUri)
      .resize({ width: NSFW_INPUT_SIZE })
      .renderAsync()
    const jpeg = await rendered.saveAsync({ base64: true, compress: 0.9, format: SaveFormat.JPEG })
    base64 = jpeg.base64 || ''
  } catch {
    // Not something the platform can decode, so not something it can judge.
    return MEDIA_UNSCANNED
  } finally {
    try { scratch?.delete() } catch {}
  }
  if (!base64) return MEDIA_UNSCANNED

  const id = String(++nextId)
  return await new Promise<string>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(MEDIA_UNSCANNED)
    }, SCAN_TIMEOUT_MS)
    pending.set(id, { resolve, timer })
    liveWebView?.postMessage(JSON.stringify({ id, dataUrl: `data:image/jpeg;base64,${base64}` }))
  })
}

// All three are .txt, which Metro already treats as an asset. Giving the
// weights their own extension would mean a resolver change, and a Metro that
// has not been restarted then fails to build rather than falling back.
// Copied out of the bundle into one folder so the page can pull them in with
// script tags. A file:// page cannot fetch its own siblings on iOS, and a
// six megabyte page handed over as a prop fails on Android, so this is what
// reaches both.
async function stageScannerFiles () {
  // Rebuilt from scratch every launch. Keeping whatever was already there
  // meant a truncated copy from an earlier build survived forever, and no
  // amount of fixing the classifier could take effect. Copying a few megabytes
  // file to file is cheap next to being silently broken.
  const folder = new Directory(Paths.cache, 'peersky-nsfw')
  if (folder.exists) folder.delete()
  folder.create()

  for (const [module, name] of [
    [require('../../assets/nsfw/nsfwjs.txt'), NSFW_LIBRARY_FILE],
    [require('../../assets/nsfw/model-data.txt'), NSFW_MODEL_FILE]
  ] as Array<[number, string]>) {
    const asset = Asset.fromModule(module)
    await asset.downloadAsync()
    const source = new File(asset.localUri || asset.uri)
    const target = new File(folder, name)
    source.copy(target)
    if (!target.exists || (target.size ?? 0) < 1000) {
      throw new Error(`${name} did not stage (${target.size ?? 0} bytes)`)
    }
  }

  const page = new File(folder, NSFW_PAGE_FILE)
  page.create()
  page.write(buildNsfwScannerPage())
  return { folder: folder.uri, page: page.uri }
}

/**
 * Runs the same vendored model the desktop app uses, inside a hidden WebView.
 * That avoids a native classifier: no extra runtime per ABI, no model
 * conversion, and one classifier to reason about across both platforms.
 *
 * Mounted once by the app shell. It registers itself as the upload gate's
 * scanner, so nothing else has to know it exists.
 */
export const NsfwScanner = memo(function NsfwScanner () {
  const [pageUri, setPageUri] = useState<string | null>(null)
  const [folderUri, setFolderUri] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void stageScannerFiles()
      .then((staged) => {
        if (cancelled) return
        setFolderUri(staged.folder)
        setPageUri(staged.page)
      })
      .catch((error) => {
        // Without the model nothing can be judged. Uploads still work; they are
        // simply unscanned, which is what the gate already assumes.
        console.warn('[nsfw] could not stage the classifier:', error)
        setStatus('unavailable')
      })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setUploadScanner((asset: UploadAsset) => scanMedia(asset))
    return () => {
      setUploadScanner(null)
      for (const id of [...pending.keys()]) settle(id, MEDIA_UNSCANNED)
    }
  }, [])

  // A fresh object every render is a new source to the WebView, which reloads
  // the page and orphans any scan already in flight until it times out as
  // unscanned. The parent re-renders on every PeerChat change, so this matters.
  const source = useMemo(() => ({ uri: pageUri || '' }), [pageUri])

  if (!pageUri) return null

  return (
    <View pointerEvents='none' style={styles.hidden}>
      <WebView
        androidLayerType='software'
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowingReadAccessToURL={folderUri || undefined}
        onMessage={(event) => {
          let message: { id?: string, predictions?: unknown, error?: string, ready?: boolean }
          try {
            message = JSON.parse(event.nativeEvent.data)
          } catch {
            return
          }

          // Without this the classifier failing to start looks exactly like a
          // clean picture: silence, and every upload waved through.
          if (message.ready !== undefined) {
            if (message.ready) {
              console.log('[nsfw] classifier ready')
              setStatus('ready')
            } else {
              console.warn('[nsfw] classifier failed to start:', message.error)
              setStatus('unavailable')
            }
            return
          }

          if (!message.id) return
          // A classifier that could not read the picture has not cleared it.
          settle(message.id, message.error ? MEDIA_UNSCANNED : verdictFromPredictions(message.predictions))
        }}
        onError={(event) => {
          console.warn('[nsfw] classifier page failed:', event.nativeEvent.description)
          setStatus('unavailable')
        }}
        ref={(instance) => { liveWebView = instance }}
        source={source}
      />
    </View>
  )
})

const styles = StyleSheet.create({
  // Off screen rather than display:none, so the WebView still runs. A hidden
  // WebView is paused on both platforms and would never answer.
  hidden: { height: 1, left: -10_000, opacity: 0, position: 'absolute', top: -10_000, width: 1 }
})
