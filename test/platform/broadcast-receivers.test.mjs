import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'

const templates = new URL('../../plugins/templates/', import.meta.url)

// Who sends each broadcast the app listens for decides how its receiver is
// registered. One closed to other apps (RECEIVER_NOT_EXPORTED) hears only the
// app itself and Android's own system process. PeerChat's unlock receiver was
// closed, but System UI sends the unlock and is an app of its own, so a phone
// Android had brought back while it was locked stayed offline after the
// unlock. A broadcast not listed here fails until its sender is.
const SENDERS = {
  // Android's own system process.
  'Intent.ACTION_SCREEN_OFF': 'RECEIVER_NOT_EXPORTED',
  // System UI. Protected, so no app can send it.
  'Intent.ACTION_USER_PRESENT': 'RECEIVER_EXPORTED',
  // The download provider, an app of its own. Protected too.
  'DownloadManager.ACTION_DOWNLOAD_COMPLETE': 'RECEIVER_EXPORTED',
  // The app's own.
  'PeerChatBackgroundService.ACTION_TICK': 'RECEIVER_NOT_EXPORTED',
  '"<package>$TASK_REMOVED_ACTION"': 'RECEIVER_NOT_EXPORTED'
}

test('each broadcast receiver is open to whoever sends its broadcast', async () => {
  const receivers = []
  for (const name of await readdir(templates)) {
    if (!name.endsWith('.kt.template')) continue
    const source = await readFile(new URL(name, templates), 'utf8')
    const read = [...source.matchAll(/ContextCompat\.registerReceiver\(\s*[^,]+,\s*[^,]+,\s*IntentFilter\(([^)]*)\),\s*ContextCompat\.(RECEIVER_\w+)\s*\)/g)]
    // Each registration is one read above: none slips past written another way.
    assert.equal(read.length, source.match(/(?<!un)registerReceiver\(/g)?.length ?? 0, `${name}: a receiver registered another way`)
    for (const [, filter, flag] of read) {
      const action = filter.trim().replace(/\$\{reactApplicationContext\.packageName\}/g, '<package>')
      receivers.push({ name, action, flag })
    }
  }

  assert.ok(receivers.length >= 5, 'the receivers were not found')
  for (const { name, action, flag } of receivers) {
    assert.ok(SENDERS[action], `${name}: who sends ${action}? Add it to SENDERS`)
    assert.equal(flag, SENDERS[action], `${name}: ${action} needs ${SENDERS[action]}`)
  }
})
