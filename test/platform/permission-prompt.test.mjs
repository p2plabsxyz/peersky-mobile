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

test('the picker asks for the camera, and never for the whole photo library', async () => {
  const gate = await readFile(new URL('../../app/media/upload-gate.ts', import.meta.url), 'utf8')

  assert.match(gate, /requestCameraPermissionsAsync\(\)/)
  // The system photo picker hands back only what was chosen and needs no
  // permission, so asking for the library was a prompt with nothing behind it.
  assert.doesNotMatch(gate, /requestMediaLibraryPermissionsAsync/)
  assert.equal((gate.match(/ensurePermission\(\{/g) || []).length, 1)
  // And a refusal still stops the pick rather than opening an empty picker.
  assert.match(gate, /if \(!allowed\) throw new Error/)
})

// The LAN page is where somebody goes when nearby devices are not showing up,
// so a genuine failure there says why and offers the one place the answer can
// be changed. No app can ask for the local network a second time.
test('a failed local discovery explains itself and offers settings', async () => {
  const settings = await readFile(new URL('../../app/settings/SettingsScreen.tsx', import.meta.url), 'utf8')

  // Only on a real failure, which the backend reports; "no peers nearby" is
  // the normal case and says nothing.
  assert.match(settings, /lanStatus && !lanStatus\.available &&/)
  assert.match(settings, /offerPermissionSettings\(LAN_PERMISSION_TITLE, LAN_PERMISSION_HELP\)/)

  // Each system keeps the switch somewhere different, so the words differ.
  assert.match(source, /Platform\.OS === 'ios'/)
  assert.match(source, /Local Network back on for PeerSky/)
  assert.match(source, /Nearby devices is allowed for PeerSky/)
  // And Wi-Fi being off looks identical from in here, so both say so.
  assert.equal((source.match(/Wi-Fi/g) || []).length >= 2, true)
})

// Permissions lists the local network beside the camera and notifications, and
// a refusal there offers the way back to Settings.
test('the local network has its own row in Permissions', async () => {
  const permissions = await readFile(new URL('../../app/settings/Permissions.tsx', import.meta.url), 'utf8')
  assert.match(permissions, /title='Local network'/)
  assert.match(permissions, /onCallRpc\(RPC_HYPER_LAN_STATUS, \{\}\)/)
  assert.match(permissions, /else offerPermissionSettings\(LAN_PERMISSION_TITLE, LAN_PERMISSION_HELP\)/)
})
