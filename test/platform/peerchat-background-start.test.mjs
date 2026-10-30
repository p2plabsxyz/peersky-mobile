import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { ANDROID_TEXT } from '../../app/i18n/native-strings.mjs'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

// PeerChat only started when the app's screen opened. When Android brought
// PeerSky back by itself, after it stopped the app, a reboot or an update,
// only the service's notice came back, saying "Staying connected" over a
// phone that was offline until someone opened the app.
test('the PeerChat service starts PeerChat itself when Android brings PeerSky back', async () => {
  const service = await read('plugins/templates/PeerChatBackgroundService.kt.template')
  const start = service.slice(service.indexOf('override fun onStartCommand'), service.indexOf('override fun onDestroy'))
  assert.match(start, /if \(status != STATUS_CONNECTED\) \{\s+startPeerChat\(\)/)
  // Sticky still, and the boot receiver still starts the service.
  assert.match(start, /return START_STICKY/)

  const task = service.slice(service.indexOf('private fun startPeerChat'), service.indexOf('// Connecting, connected or offline'))
  // React Native with no activity, and a headless task in it.
  assert.match(task, /\(application as\? ReactApplication\)\?\.reactHost/)
  assert.match(task, /host\.addReactInstanceEventListener[\s\S]*host\.start\(\)/)
  assert.match(task, /HeadlessJsTaskContext\.getInstance\(context\)\.startTask\(\s+HeadlessJsTaskConfig\(TASK_KEY, Arguments\.createMap\(\), TASK_TIMEOUT_MS, true\)/)
  // Once is enough while one is starting, and a refusal never takes the app down.
  assert.match(task, /now - taskStartedAt < TASK_TIMEOUT_MS\) return/)
  assert.match(task, /catch \(error: Exception\)/)
  // A debug build's JavaScript is the dev launcher's to pick.
  assert.match(task, /if \(BuildConfig\.BUILD_TYPE == "debug"\) return/)
  // No wake lock: once running, PeerChat goes on by the network and the tick.
  assert.doesNotMatch(service, /WakeLock|acquireWakeLockNow/)

  // The task the service names is the one the app registers.
  const name = service.match(/TASK_KEY = "([^"]+)"/)?.[1]
  assert.equal(name, 'PeerChatBackground')
  const entry = await read('index.js')
  assert.match(entry, /^(?:\/\/[^\n]*\n)+import 'expo-router\/entry'\n/)
  assert.match(entry, new RegExp(`AppRegistry\\.registerHeadlessTask\\('${name}', \\(\\) => require\\('\\./app/peerchat/background-task'\\)\\.runPeerChatBackgroundTask\\)`))
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.main, 'index.js')
})

test('the task starts the backend and the checks for messages, as the screen does', async () => {
  const task = await read('app/peerchat/background-task.ts')
  // The notifications are in the language picked in PeerSky.
  assert.match(task, /^\/\/[^\n]*\nimport '\.\.\/i18n\/setup'/)
  const run = task.slice(task.indexOf('export async function runPeerChatBackgroundTask'))
  // Offline folders wait for the screen, which knows the Wi-Fi setting.
  assert.match(run, /await startBackend\(\{ allowNetwork: false \}\)/)
  assert.match(run, /RPC_PEERCHAT_PRESENCE, \{ idle: AppState\.currentState !== 'active' \}/)
  assert.match(run, /await startPeerChatChecks\(\)/)
  assert.match(run, /catch \(error\) \{[\s\S]*reportPeerChatOffline\(\)/)
  // A new message is looked for the moment the backend says so: in the
  // background the app's timers wait and the tick comes once a minute.
  assert.match(task, /if \(request\.command === RPC_APP_PEERCHAT_CHANGED\) checkPeerChatNow\(\)/)

  // The screen takes up the backend and the checks the task started.
  const app = await read('app/index.tsx')
  assert.match(app, /await startBackend\(\{ allowNetwork: hyperOfflineNetworkAllowedRef\.current \}\)\n\s+rpcRef\.current = getBackendRpc\(\)[\s\S]{0,120}void startPeerChatChecks\(\)/)
  const notifier = await read('app/peerchat/notifier.ts')
  assert.match(notifier, /if \(checker\) \{\n\s+checker\.callRpc = callRpc\n\s+return Promise\.resolve\(\)/)
})

// Swiping PeerSky away from Recents kept it online, but the checks for new
// messages lived in the screen, so notifications stopped until it was opened.
test('a swipe away leaves PeerChat connected and showing new messages', async () => {
  const app = await read('app/index.tsx')
  const mount = app.slice(app.indexOf('  useEffect(() => {\n    void startWorklet()'), app.indexOf('// What the backend tells the app'))
  assert.doesNotMatch(mount, /return \(\) =>/)
  assert.doesNotMatch(app, /\.terminate\(\)/)
  // The hook only reads and sets; it starts and stops nothing.
  const hook = await read('app/peerchat/usePeerChatNotifications.ts')
  assert.doesNotMatch(hook, /startPeerChatNotifier|stopPeerChatNotifier|RPC_PEERCHAT_ROOMS|setTimeout/)
  assert.match(hook, /useSyncExternalStore\(subscribePeerChatNotifier, getPeerChatNotifierState\)/)
})

test('the service\'s notice never says connected while PeerChat is not running', async () => {
  const service = await read('plugins/templates/PeerChatBackgroundService.kt.template')
  const notice = service.slice(service.indexOf('private fun buildNotification'), service.indexOf('private fun refreshNotification'))
  assert.match(notice, /STATUS_CONNECTED -> getString\(R\.string\.peerchat_background_text\)/)
  assert.match(notice, /STATUS_OFFLINE -> getString\(R\.string\.peerchat_background_offline\)/)
  assert.match(notice, /else -> getString\(R\.string\.peerchat_background_connecting\)/)
  // A new process starts from connecting, with nothing running in it yet.
  assert.match(service, /@Volatile private var status = STATUS_CONNECTING/)
  // Connecting for too long becomes offline.
  assert.match(service, /private val connectWatch = Runnable \{\n\s+if \(status == STATUS_CONNECTING\) \{\n\s+status = STATUS_OFFLINE/)
  assert.match(service, /CONNECT_WAIT_MS = 180_000L/)
  assert.ok(ANDROID_TEXT.peerchat_background_connecting)
  assert.ok(ANDROID_TEXT.peerchat_background_offline)

  // The app says connected once PeerChat answers, and offline when the
  // backend could not start.
  const module = await read('plugins/templates/PeerChatBackgroundModule.kt.template')
  assert.match(module, /@ReactMethod\n\s+fun setStatus\(status: String\) \{\n\s+PeerChatBackgroundService\.setStatus\(status\)/)
  const notifier = await read('app/peerchat/notifier.ts')
  const poll = notifier.slice(notifier.indexOf('async function poll'))
  assert.ok(poll.indexOf("setPeerChatBackgroundStatus('connected')") > poll.indexOf('if (!response.ok) throw new Error'))
  assert.match(notifier, /export function reportPeerChatOffline \(\) \{\n\s+reportedConnected = false\n\s+setPeerChatBackgroundStatus\('offline'\)/)
})

test('the service runs only once PeerChat has said there is a chat', async () => {
  const notifier = await read('app/peerchat/notifier.ts')
  const update = notifier.slice(notifier.indexOf('function updateBackgroundService'), notifier.indexOf('async function poll'))
  // Before the first look nothing is known, and a service Android started
  // is left running, as it was not when the screen stopped it at every start.
  assert.match(update, /if \(!checker \|\| previousRooms === null\) return/)
  assert.match(update, /if \(wanted === backgroundWanted\) return/)
})

// A clear or a restore replaces the data under the backend, which outlives
// the screen now. It is made again as PeerSky opens next, and nothing opens
// PeerChat on the data going in the meantime.
test('a clear or a restore makes a new backend and stops the PeerChat service', async () => {
  const app = await read('app/index.tsx')
  const restart = app.slice(app.indexOf('function onRestartRequired ()'), app.indexOf('function onBrowserBurnTabs'))
  assert.match(restart, /requireBackendRestart\(\)\n\s+stopPeerChatNotifier\(\{ disableService: true \}\)/)

  const notifier = await read('app/peerchat/notifier.ts')
  const stop = notifier.slice(notifier.indexOf('export function stopPeerChatNotifier'), notifier.indexOf('export function reportPeerChatOffline'))
  assert.match(stop, /current\.cancelled = true/)
  assert.match(stop, /if \(disableService\) \{[\s\S]*setPeerChatBackgroundEnabled\(false\)/)
})

// A PeerChat tab brought back at startup opens before the backend is up and
// asks for its profile at once. That call failed with "Worklet is not ready",
// and the chat list showed "Set up your profile" until something was tapped.
test('a call made while the backend is starting waits for it', async () => {
  const backend = await read('app/backend.ts')
  const call = backend.slice(backend.indexOf('export async function callBackend'), backend.indexOf('export function onBackendRequest'))
  assert.match(call, /if \(!rpc && starting\) await starting\.catch\(\(\) => \{\}\)\n\s+const current = rpc\n\s+if \(!current\) throw new Error\(t\('Worklet is not ready'\)\)/)
  // The start's own first call goes out once the worklet is made, so it
  // never waits on itself.
  const start = backend.slice(backend.indexOf('async function startOnce'), backend.indexOf('export async function callBackend'))
  assert.ok(start.indexOf('rpc = nextRpc') < start.indexOf('await callBackend(RPC_HYPER_INIT'))
})
