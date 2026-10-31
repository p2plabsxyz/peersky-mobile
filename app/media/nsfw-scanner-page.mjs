// The page the hidden WebView runs. Deliberately tiny: the library and the
// model are copied into the same folder and pulled in with script tags rather
// than built into one enormous string. A six megabyte page handed over as a
// prop is slow on iOS and silently fails on Android.
//
// Script tags are the only way in. A file:// page cannot fetch its own
// siblings on iOS, so the model arrives as JavaScript that assigns two globals,
// and fetch is replaced with one that answers tfjs out of those.
//
// A second model checks for gore and graphic violence: safety-model.js, its
// weights in safety-data.js the same way, run on tf-core.js. That is
// TensorFlow.js 4.22.0 without backends: TensorFlow.js keeps one engine per
// page on the global object, so loaded after nsfwjs it runs on the engine and
// backends nsfwjs brought.

export const NSFW_MODEL_URL = 'https://peersky.local/nsfw/model.json'
export const NSFW_WEIGHTS_NAME = 'group1-shard1of1'
export const NSFW_INPUT_SIZE = 224
export const NSFW_LIBRARY_FILE = 'nsfwjs.js'
export const NSFW_MODEL_FILE = 'model-data.js'
export const NSFW_PAGE_FILE = 'scanner.html'
export const SAFETY_CORE_FILE = 'tf-core.js'
export const SAFETY_SCRIPT_FILE = 'safety-model.js'
export const SAFETY_DATA_FILE = 'safety-data.js'

export function buildNsfwScannerPage () {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script src="./${NSFW_MODEL_FILE}"></script>
<script src="./${NSFW_LIBRARY_FILE}"></script>
<script src="./${SAFETY_CORE_FILE}"></script>
<script src="./${SAFETY_SCRIPT_FILE}"></script>
<script src="./${SAFETY_DATA_FILE}"></script>
<script>
(function () {
  var MODEL_URL = ${JSON.stringify(NSFW_MODEL_URL)}
  var WEIGHTS_NAME = ${JSON.stringify(NSFW_WEIGHTS_NAME)}
  var SIZE = ${NSFW_INPUT_SIZE}

  function reply (payload) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(payload))
  }

  if (!window.nsfwjs || !window.__NSFW_MODEL_JSON || !window.__NSFW_WEIGHTS_B64) {
    reply({ ready: false, error: 'classifier files did not load' })
    return
  }

  var weights = Uint8Array.from(atob(window.__NSFW_WEIGHTS_B64), function (c) { return c.charCodeAt(0) })
  // Freed once decoded: the base64 copy is another three megabytes.
  window.__NSFW_WEIGHTS_B64 = null

  window.fetch = function (input) {
    var url = String(typeof input === 'string' ? input : (input && input.url) || '')
    if (url === MODEL_URL) {
      return Promise.resolve(new Response(JSON.stringify(window.__NSFW_MODEL_JSON), {
        status: 200, headers: { 'content-type': 'application/json' }
      }))
    }
    if (url.indexOf(WEIGHTS_NAME) !== -1) {
      return Promise.resolve(new Response(weights.buffer, {
        status: 200, headers: { 'content-type': 'application/octet-stream' }
      }))
    }
    // There is no network here, and nothing else has any business asking.
    return Promise.reject(new Error('blocked: ' + url))
  }

  var modelPromise = null
  function model () {
    if (!modelPromise) modelPromise = window.nsfwjs.load(MODEL_URL, { size: SIZE })
    return modelPromise
  }

  // Null when it cannot start, so pictures are still checked for what nsfwjs
  // knows. Built after nsfwjs, whose TensorFlow.js engine it runs on.
  var safetyError = ''
  var safetyPromise = null
  function safety () {
    if (!safetyPromise) {
      safetyPromise = model().then(function () {
        if (!window.tf || !window.createSafetyModel || !window.__SAFETY_MANIFEST || !window.__SAFETY_WEIGHTS_B64) {
          throw new Error('safety model files did not load')
        }
        var bytes = Uint8Array.from(atob(window.__SAFETY_WEIGHTS_B64), function (c) { return c.charCodeAt(0) })
        window.__SAFETY_WEIGHTS_B64 = null
        return window.createSafetyModel(window.tf, window.__SAFETY_MANIFEST, bytes)
      }).catch(function (error) {
        safetyError = String((error && error.message) || error)
        return null
      })
    }
    return safetyPromise
  }

  function draw (source, width, height, quality) {
    var canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    var context = canvas.getContext('2d')
    context.imageSmoothingQuality = quality || 'low'
    context.drawImage(source, 0, 0, width, height, 0, 0, SIZE, SIZE)
    return canvas
  }

  function scan (request) {
    var image = new Image()
    image.src = request.dataUrl
    image.decode()
      .then(function () {
        return Promise.all([model(), safety()]).then(function (models) {
          // nsfwjs keeps the canvas it always had. The safety model learned
          // from smoothly shrunk pictures.
          return Promise.all([
            models[0].classify(draw(image, image.naturalWidth, image.naturalHeight)),
            models[1]
              ? models[1].classify(draw(image, image.naturalWidth, image.naturalHeight, 'high')).catch(function () { return null })
              : null
          ])
        })
      })
      .then(function (results) { reply({ id: request.id, predictions: results[0], safety: results[1] }) })
      .catch(function (error) { reply({ id: request.id, error: String((error && error.message) || error) }) })
  }

  function onRequest (event) {
    var request
    try { request = JSON.parse(event.data) } catch (e) { return }
    if (request && request.id && request.dataUrl) scan(request)
  }
  document.addEventListener('message', onRequest)
  window.addEventListener('message', onRequest)

  // Warmed now so the first picture is not the slow one, and so a model that
  // cannot load says so instead of failing silently on the first upload.
  Promise.all([model(), safety()]).then(function (models) {
    reply({ ready: true, safety: !!models[1], safetyError: safetyError })
  }, function (error) {
    reply({ ready: false, error: String((error && error.message) || error) })
  })
})()
</script></body></html>`
}
