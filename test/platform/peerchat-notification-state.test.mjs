import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  collectPeerChatNotificationCandidates,
  DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES,
  MAX_PEERCHAT_NOTIFICATIONS_PER_POLL,
  parsePeerChatNotificationPreferences,
  serializePeerChatNotificationPreferences,
  shouldEnablePeerChatBackground,
  shouldHandlePeerChatNotificationInApp
} from '../../app/peerchat/notification-state.mjs'

test('PeerChat notification preferences round-trip and fail safely', () => {
  assert.deepEqual(
    parsePeerChatNotificationPreferences(serializePeerChatNotificationPreferences({ notifications: false, sounds: false })),
    { notifications: false, sounds: false }
  )
  assert.deepEqual(parsePeerChatNotificationPreferences('{broken'), DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES)
  assert.deepEqual(parsePeerChatNotificationPreferences('x'.repeat(300)), DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES)
  assert.deepEqual(parsePeerChatNotificationPreferences('{"version":1}'), {
    notifications: false,
    sounds: true
  })
})

test('PeerChat notifications default on while preserving explicit saved choices', () => {
  assert.deepEqual(DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES, {
    notifications: true,
    sounds: true
  })
  assert.deepEqual(
    parsePeerChatNotificationPreferences(serializePeerChatNotificationPreferences({ notifications: false, sounds: true })),
    { notifications: false, sounds: true }
  )
})

test('PeerChat emits bounded notifications only for new unread unmuted messages', () => {
  const previous = Array.from({ length: 5 }, (_, index) => ({ roomKey: `room-${index}`, unreadCount: 0 }))
  const next = previous.map((room, index) => ({
    ...room,
    name: `Room ${index}`,
    unreadCount: 1,
    isMuted: index === 0,
    lastMessage: { sender: 'peer', senderName: 'Alice', message: `Message ${index}`, timestamp: index }
  }))
  const candidates = collectPeerChatNotificationCandidates(previous, next)

  assert.equal(candidates.length, MAX_PEERCHAT_NOTIFICATIONS_PER_POLL)
  assert.deepEqual(candidates.map((candidate) => candidate.roomKey), ['room-2', 'room-3', 'room-4'])
  assert.equal(collectPeerChatNotificationCandidates([], next).length, 0)
  assert.equal(collectPeerChatNotificationCandidates(previous, previous).length, 0)
})

test('PeerChat notification text is sanitized and bounded', () => {
  const [candidate] = collectPeerChatNotificationCandidates(
    [{ roomKey: 'room', unreadCount: 0 }],
    [{
      roomKey: 'room',
      name: `Room\u0000${'x'.repeat(100)}`,
      unreadCount: 1,
      lastMessage: { sender: 'peer', senderName: 'Alice', message: 'y'.repeat(300), timestamp: 1 }
    }]
  )

  assert.equal(Array.from(candidate.title).length, 80)
  assert.equal(Array.from(candidate.body).length, 180)
  assert.equal(candidate.title.includes('\u0000'), false)
})

test('PeerChat handles notifications in-app only while its screen is foreground-active', () => {
  assert.equal(shouldHandlePeerChatNotificationInApp(true, 'active'), true)
  assert.equal(shouldHandlePeerChatNotificationInApp(true, 'background'), false)
  assert.equal(shouldHandlePeerChatNotificationInApp(true, 'inactive'), false)
  assert.equal(shouldHandlePeerChatNotificationInApp(false, 'active'), false)
})

test('PeerChat background service runs only for enabled runtimes with joined rooms', () => {
  assert.equal(shouldEnablePeerChatBackground({ isRuntimeReady: true, notificationsEnabled: true, roomCount: 1 }), true)
  assert.equal(shouldEnablePeerChatBackground({ isRuntimeReady: true, notificationsEnabled: true, roomCount: 0 }), false)
  assert.equal(shouldEnablePeerChatBackground({ isRuntimeReady: true, notificationsEnabled: false, roomCount: 1 }), false)
  assert.equal(shouldEnablePeerChatBackground({ isRuntimeReady: false, notificationsEnabled: true, roomCount: 1 }), false)
})

test('PeerChat leaves a declined notification prompt alone and deep links to the app page', async () => {
  const source = await readFile(new URL('../../app/peerchat/notifications.ts', import.meta.url), 'utf8')
  const request = source.slice(
    source.indexOf('export async function requestPeerChatNotificationPermission'),
    source.indexOf('export async function isPeerChatNotificationBlocked')
  )

  // Declining is an answer. Pushing the user into Settings right after they said
  // no is what this guards against.
  assert.equal(request.includes('openSettings'), false)
  assert.equal(request.includes('Linking.'), false)

  // UIApplication.openNotificationSettingsURLString, iOS 15.4 and newer.
  assert.match(source, /Linking[.]openURL[(]'app-settings:notifications'[)]/)
  const openSettings = source.slice(source.indexOf('export async function openPeerChatNotificationSettings'))
  assert.match(openSettings, /await Linking[.]openSettings[(][)]/)
})

test('PeerChat only offers notification settings once the system stops asking', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const change = screen.slice(
    screen.indexOf('function changeNotifications ()'),
    screen.indexOf('function changeNotificationSounds ()')
  )

  assert.match(change, /if \(!await isPeerChatNotificationBlocked\(\)\)/)
  assert.match(change, /openPeerChatNotificationSettings\(\)/)
  assert.match(change, /Alert[.]alert\(/)
})

test('PeerChat keeps its swarm announce fresh while the app sits in the background', async () => {
  const hook = await readFile(new URL('../../app/peerchat/usePeerChatNotifications.ts', import.meta.url), 'utf8')
  const tick = hook.slice(
    hook.indexOf('const backgroundTickSubscription'),
    hook.indexOf('void preparePeerChatNotifications()')
  )

  assert.match(tick, /RPC_HYPER_REFRESH/)
  // Only while backgrounded. Foregrounding already refreshes from app/index.tsx.
  assert.match(tick, /AppState[.]currentState === 'active'/)

  const interval = hook.match(/BACKGROUND_REFRESH_INTERVAL_MS = ([^\n]+)/)
  assert.ok(interval, 'refresh interval not found')
  // eslint-disable-next-line no-new-func
  const value = Function(`return (${interval[1]})`)()
  assert.ok(value >= 5 * 60 * 1000, 'refreshing this often would drain the battery')
})

test('PeerChat offers the Android battery exemption after notifications are turned on', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const offer = screen.slice(
    screen.indexOf('async function offerBatteryExemption'),
    screen.indexOf('function changeNotificationSounds')
  )

  assert.match(offer, /Platform[.]OS !== 'android'/)
  assert.match(offer, /isPeerChatBatteryUnrestricted\(\)/)
  assert.match(offer, /openPeerChatBatterySettings\(\)/)
  // Samsung puts its sleeping-apps list somewhere else, so that sentence is
  // wrong on a Pixel and only shows on a Samsung.
  assert.match(offer, /Platform[.]constants\?[.]Manufacturer/)
  assert.match(offer, /const samsungHint = isSamsung/)
  assert.match(offer, /Sleeping apps/)
})

test('PeerChat About answers the questions a first-time user actually asks', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const about = screen.slice(
    screen.indexOf('const PEERCHAT_ABOUT = ['),
    screen.indexOf('function PeerChatMediaViewer')
  )

  // The awkward ones get a straight answer rather than a dodge.
  assert.match(about, /Why can I not delete a message\?/)
  assert.match(about, /Can I delete my account\?/)
  assert.match(about, /their phone is theirs/)
  assert.match(about, /stays with the people you sent it to/)

  // Privacy is the reason to pick this over anything else, so it is asked
  // outright rather than left to be inferred.
  assert.match(about, /What do you know about me\?/)
  assert.match(about, /No tracking, no analytics/)
  assert.match(about, /Who can read my messages\?/)

  // "Is this secure" is the question the whole app rests on, so it names how a
  // room is locked, how a one to one chat is locked, and what neither hides.
  assert.match(about, /Are my chats secure\?/)
  assert.match(about, /locked with its room key/)
  assert.match(about, /its own key, made fresh for that conversation/)
  assert.match(about, /cannot be worked out from your name or your code/)
  assert.match(about, /can see your network address/)
  assert.match(about, /a room key never expires/)

  // And the peer to peer facts a normal person trips over.
  assert.match(about, /both need to be awake/)
  assert.match(about, /start fresh from the moment you join/)
  assert.match(about, /same WiFi/)

  // Source code stays in settings, not buried in About.
  assert.doesNotMatch(about, /PEERCHAT_SOURCE_URL/)
  assert.match(screen, /setSettingsPage\('about'\)[\s\S]{0,900}PEERCHAT_SOURCE_URL/)

  // Opened as its own page inside the sheet. A second modal over the settings
  // sheet is what crashed iOS.
  assert.match(screen, /setSettingsPage\('about'\)/)
  assert.match(screen, /settingsPage === 'about' && \(\s*<PeerChatAboutPage/)
  assert.doesNotMatch(about, /<Modal/)
})

// A direct message is named after the one person who can be in it, so a body
// of "Akhilesh: Hi" under a title of "Akhilesh" said the name twice.
test('a direct message notification does not repeat the sender', () => {
  const previous = [{ roomKey: 'a'.repeat(64), unreadCount: 0 }]
  const next = [{
    roomKey: 'a'.repeat(64),
    name: 'Akhilesh',
    isDM: true,
    unreadCount: 1,
    lastMessage: { sender: 'peer', senderName: 'Akhilesh', message: 'Hi', timestamp: 2 }
  }]

  assert.deepEqual(collectPeerChatNotificationCandidates(previous, next), [{
    roomKey: 'a'.repeat(64),
    title: 'Akhilesh',
    body: 'Hi'
  }])
})

test('a room notification still says who sent it', () => {
  const previous = [{ roomKey: 'b'.repeat(64), unreadCount: 0 }]
  const next = [{
    roomKey: 'b'.repeat(64),
    name: 'Peer-to-Peer Republic',
    unreadCount: 1,
    lastMessage: { sender: 'peer', senderName: 'Bob', message: 'Hi', timestamp: 2 }
  }]

  assert.deepEqual(collectPeerChatNotificationCandidates(previous, next), [{
    roomKey: 'b'.repeat(64),
    title: 'Peer-to-Peer Republic',
    body: 'Bob: Hi'
  }])
})
