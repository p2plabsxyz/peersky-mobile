import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

// A link shared to PeerSky from another app on Android opens in a tab.

const require = createRequire(import.meta.url)
const { addShareToOpenActivity } = require('../../plugins/with-share-to-open.js')
const read = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')

const manifest = () => ({
  manifest: { application: [{ activity: [{ $: { 'android:name': '.MainActivity' } }] }] }
})

test('a windowless activity takes text shared to PeerSky, once', () => {
  const once = addShareToOpenActivity(manifest())
  const twice = addShareToOpenActivity(once)
  const activities = twice.manifest.application[0].activity.filter((activity) => activity.$['android:name'] === '.ShareToOpenActivity')
  assert.equal(activities.length, 1)
  const [activity] = activities
  assert.equal(activity.$['android:exported'], 'true')
  assert.equal(activity.$['android:noHistory'], 'true')
  assert.equal(activity.$['android:theme'], '@android:style/Theme.Translucent.NoTitleBar')
  const [filter] = activity['intent-filter']
  assert.equal(filter.action[0].$['android:name'], 'android.intent.action.SEND')
  assert.equal(filter.data[0].$['android:mimeType'], 'text/plain')
})

test('it opens the link in the app as a tapped link would, and is in the build', async () => {
  const activity = await read('plugins/templates/ShareToOpenActivity.kt.template')
  assert.match(activity, /Intent\(Intent\.ACTION_VIEW, Uri\.parse\(link\), this, MainActivity::class\.java\)/)
  assert.match(activity, /Regex\("\(\?:https\?\|hyper\):\/\/\[\^\\\\s<>\\"\]\+"/)
  assert.match(activity, /finish\(\)/)
  const app = JSON.parse(await read('app.json'))
  assert.ok(app.expo.plugins.includes('./plugins/with-share-to-open'))
})
