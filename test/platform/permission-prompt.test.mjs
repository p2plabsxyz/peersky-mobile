import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const source = await readFile(new URL('../../app/permission-prompt.ts', import.meta.url), 'utf8')

// iOS shows a permission prompt once. Somebody who taps Don't Allow by accident
// is then stuck, because nothing in the app can ask again.
test('a refusal the system will not revisit offers the way back', () => {
  assert.match(source, /if \(permission\.canAskAgain === false\) offerPermissionSettings/)
  assert.match(source, /Linking\.openSettings\(\)/)
  assert.match(source, /text: 'Open settings'/)
})

test('a plain no is not argued with', () => {
  // Still askable means they just said no this time, and a dialog on top of
  // their own refusal is nagging.
  assert.match(source, /canAskAgain === false/)
  assert.doesNotMatch(source, /if \(!permission\.granted\) offerPermissionSettings/)
})

test('the picker uses it for both the camera and the library', async () => {
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')

  assert.match(gate, /requestCameraPermissionsAsync\(\)/)
  assert.match(gate, /requestMediaLibraryPermissionsAsync\(\)/)
  assert.equal((gate.match(/ensurePermission\(\{/g) || []).length, 2)
  // And a refusal still stops the pick rather than opening an empty picker.
  assert.match(gate, /if \(!allowed\) throw new Error/)
})
