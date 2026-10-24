import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'

const require = createRequire(import.meta.url)
const { keepAppOnBack, MARKER } = require('../../plugins/with-android-back-keeps-app.js')
const appJson = JSON.parse(await readFile(new URL('../../app.json', import.meta.url), 'utf8'))

// The end of MainActivity.kt as Expo's template writes it.
const MAIN_ACTIVITY = `class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
`

describe('Android back at the first page', () => {
  test('the plugin is registered', () => {
    assert.ok(appJson.expo.plugins.includes('./plugins/with-android-back-keeps-app'))
  })

  test('moves the task behind on every Android version instead of finishing it', () => {
    const source = keepAppOnBack(MAIN_ACTIVITY)
    assert.equal(source.split('override fun invokeDefaultOnBackPressed()').length, 2)
    assert.ok(source.includes(MARKER))
    assert.match(source, /if \(!moveTaskToBack\(false\)\) \{\n {10}\/\/ Not the task's root: finish it as usual\.\n {10}super\.invokeDefaultOnBackPressed\(\)\n {6}\}\n {2}\}\n\}\n$/)
    assert.doesNotMatch(source, /VERSION_CODES\.R|Align the back button/)
    assert.ok(source.startsWith('class MainActivity : ReactActivity() {\n  override fun getMainComponentName(): String = "main"\n\n  // PeerSky'))
  })

  test('applies once', () => {
    const once = keepAppOnBack(MAIN_ACTIVITY)
    assert.equal(keepAppOnBack(once), once)
  })

  test('adds the override when the template has none', () => {
    const source = keepAppOnBack('class MainActivity : ReactActivity() {\n  override fun getMainComponentName(): String = "main"\n}\n')
    assert.match(source, /"main"\n\n {2}\/\/ PeerSky[^\n]+\n {2}override fun invokeDefaultOnBackPressed\(\) \{[\s\S]+\n {2}\}\n\}\n$/)
  })
})
