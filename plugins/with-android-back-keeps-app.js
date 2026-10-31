const { withMainActivity } = require('@expo/config-plugins')

// Back with nowhere left to go closed PeerSky's screen on Android. The process
// stayed, but the app came back as from a fresh start: the logo, then every
// tab loading from the top, a PDF back on its first page. Expo's MainActivity
// leaves that step to Android 12 and later, which keep an app opened from the
// launcher, but not one whose task began with a link, a widget or a
// notification, and PeerSky is opened that way all the time. Moving the task
// behind the others keeps it as it was, the same as Home.
const MARKER = '// PeerSky: back keeps the app as it was'

const OVERRIDE = `  ${MARKER} (plugins/with-android-back-keeps-app.js).
  override fun invokeDefaultOnBackPressed() {
      if (!moveTaskToBack(false)) {
          // Not the task's root: finish it as usual.
          super.invokeDefaultOnBackPressed()
      }
  }`

const SIGNATURE = 'override fun invokeDefaultOnBackPressed()'

/** MainActivity.kt with back moving the task behind instead of finishing it, once. */
function keepAppOnBack (source) {
  if (source.includes(MARKER)) return source
  const start = source.indexOf(SIGNATURE)
  if (start === -1) {
    const end = source.lastIndexOf('}')
    if (end === -1) throw new Error('with-android-back-keeps-app: MainActivity class not found')
    return `${source.slice(0, end).trimEnd()}\n\n${OVERRIDE}\n}\n`
  }

  // The function, and the comment right above it, which describes what it did.
  let from = source.lastIndexOf('\n', start) + 1
  const before = source.slice(0, from).trimEnd()
  if (before.endsWith('*/')) from = source.lastIndexOf('\n', before.lastIndexOf('/**')) + 1

  let depth = 0
  let to = source.indexOf('{', start)
  for (; to < source.length; to++) {
    if (source[to] === '{') depth++
    if (source[to] === '}' && --depth === 0) break
  }
  if (depth !== 0) throw new Error('with-android-back-keeps-app: invokeDefaultOnBackPressed has no end')
  return source.slice(0, from) + OVERRIDE + source.slice(to + 1)
}

module.exports = function withAndroidBackKeepsApp (config) {
  return withMainActivity(config, (androidConfig) => {
    if (androidConfig.modResults.language !== 'kt') {
      throw new Error('with-android-back-keeps-app: MainActivity is expected in Kotlin')
    }
    androidConfig.modResults.contents = keepAppOnBack(androidConfig.modResults.contents)
    return androidConfig
  })
}

module.exports.keepAppOnBack = keepAppOnBack
module.exports.MARKER = MARKER
