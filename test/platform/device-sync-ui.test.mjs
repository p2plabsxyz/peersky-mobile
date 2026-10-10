import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const read = (path) => readFile(new URL(`../../app/${path}`, import.meta.url), 'utf8')
const linkDevice = await read('settings/LinkDevice.tsx')
const hyperdrive = await read('hyperdrive/HyperdriveScreen.tsx')
const index = await read('index.tsx')
const settings = await read('settings/SettingsScreen.tsx')

describe('linked devices in the app', () => {
  test('My devices lists the other devices by what they are, with when each was there', () => {
    assert.match(linkDevice, /call\(RPC_DEVICE_SYNC_STATUS\)/)
    assert.match(linkDevice, /sortLinkedDevices\(linkedDevices\)\.map/)
    assert.match(linkDevice, /icon=\{device\.type === 'phone' \? PhoneIcon : DisplayIcon\}/)
    assert.match(linkDevice, /description=\{describeLinkedDevice\(device\)\}/)
    assert.match(linkDevice, /online=\{device\.online\}/)
    // Read again when the backend says a device came or went.
    assert.match(linkDevice, /\[call, deviceSyncRevision\]/)
    assert.match(settings, /deviceSyncRevision=\{props\.deviceSyncRevision\}/)
  })

  test('a device can be taken off the list, and a linked phone with none yet says where it will show', () => {
    assert.match(linkDevice, /call\(RPC_DEVICE_SYNC_FORGET, \{ id: device\.id \}\)/)
    assert.match(linkDevice, /devicesLoaded && isLinked && linkedDevices\.length === 0/)
    assert.match(linkDevice, /title='No other device yet'/)
  })

  test('Hyperdrive shows the other devices\' private files above Recent, with See all', () => {
    assert.match(hyperdrive, /onCallRpcRef\.current\(RPC_DEVICE_SYNC_STATUS, \{\}\)/)
    assert.match(hyperdrive, /\[deviceSyncRevision\]/)
    assert.match(hyperdrive, /!items && deviceFiles\.length > 0 &&/)
    assert.match(hyperdrive, />From your devices</)
    assert.match(hyperdrive, /deviceFiles\.slice\(0, DEVICE_FILES_SHOWN\)/)
    assert.match(hyperdrive, /name: 'From your devices', url: DEVICE_FILES_URL/)
    // A folder opens in place, and nothing from a device goes in Recent.
    assert.match(hyperdrive, /await fetchLocation\(item\.url, false\)/)
    assert.match(hyperdrive, /On your \$\{item\.deviceLabel\.toLowerCase\(\)\}/)
  })

  test('the app hears when devices change and says when the phone is on cellular', () => {
    assert.match(index, /request\.command === RPC_APP_DEVICE_SYNC_CHANGED/)
    assert.match(index, /setDeviceSyncRevision\(\(value\) => value \+ 1\)/)
    assert.match(index, /callRpc\(RPC_DEVICE_SYNC_NETWORK, \{ metered: deviceSyncMetered \}\)/)
    assert.match(index, /\[deviceSyncMetered, identityStoragePath\]/)
    assert.match(index, /deviceSyncRevision=\{deviceSyncRevision\}/)
  })
})
