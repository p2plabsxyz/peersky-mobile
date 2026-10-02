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

test('PeerChat answers the questions a first-time user actually asks', async () => {
  const { PEERCHAT_QUESTIONS, PEERCHAT_USAGE_QUESTIONS, PEERCHAT_WELCOME_QUESTIONS } = await import('../../app/peerchat/questions.mjs')
  const answer = (pattern) => PEERCHAT_QUESTIONS.find(({ q }) => pattern.test(q))?.a || ''

  // Asked the way a person asks: a question, in plain words.
  for (const { q, a } of PEERCHAT_QUESTIONS) {
    assert.match(q, /\?$/)
    assert.ok(a.length > 0)
    assert.doesNotMatch(`${q} ${a}`, /—|honestly/i)
  }
  assert.deepEqual(PEERCHAT_QUESTIONS, [...PEERCHAT_WELCOME_QUESTIONS, ...PEERCHAT_USAGE_QUESTIONS])

  // Before using it: what it is, how it compares, what it costs and who
  // makes it. Nothing about blocking people or deleting things yet.
  for (const pattern of [/What is PeerChat/, /WhatsApp, Telegram or Signal/, /phone number or an email/, /friends find me/, /peer to peer mean/, /How private/, /really free/, /big files/, /phone and my computer/, /iPhone and Android/, /Who makes/]) {
    assert.ok(PEERCHAT_WELCOME_QUESTIONS.some(({ q }) => pattern.test(q)), String(pattern))
  }
  for (const pattern of [/bothering me/, /delete my account/, /unsend/]) {
    assert.ok(!PEERCHAT_WELCOME_QUESTIONS.some(({ q }) => pattern.test(q)), String(pattern))
  }

  // What PeerChat is, said outright: no accounts, no servers, works without
  // internet, end to end encrypted.
  assert.match(answer(/phone number or an email/), /Pick a name and you.re in/)
  assert.match(answer(/WhatsApp, Telegram or Signal/), /end to end encrypted/)
  assert.match(answer(/without internet/), /Any local network will do/)
  assert.match(answer(/really free/), /no ads, no subscriptions/)

  // Knowing where a room is on the network gets nobody in.
  assert.match(answer(/stranger on the network/), /prove it holds the room.s key/)
  assert.match(answer(/stranger on the network/), /never goes over the wire/)

  // The awkward ones get a straight answer rather than a dodge.
  assert.match(answer(/unsend/), /their device is theirs/)
  assert.match(answer(/delete my account/), /Delete PeerChat profile/)
  assert.match(answer(/delete my account/), /stays with the people you sent it to/)
  assert.match(answer(/How private/), /no tracking, no analytics/)

  // "How private is it" names what it does not hide, and a one to one chat
  // says how it is locked.
  assert.match(answer(/How private/), /can see your network address/)
  assert.match(answer(/How private/), /a room key never expires/)
  assert.match(answer(/one to one/), /made fresh for that conversation/)
  assert.match(answer(/one to one/), /can.t be worked out from your name or your code/)

  // The peer to peer facts a normal person trips over.
  assert.match(answer(/message arrive/), /both of you need to be online/)
  assert.match(answer(/older messages/), /start fresh from the moment you join/)

  // Several devices at once, each with its label.
  assert.match(answer(/phone and my computer/), /as many computers as you like, all at the same time/)

  // Blocking and reporting say what they do, and the room key stays out of it.
  assert.match(answer(/bothering me/), /Everything they send disappears for you, in every chat/)
  assert.match(answer(/bothering me/), /with the message you reported/)
  assert.doesNotMatch(answer(/bothering me/), /key/)
})

test('PeerChat shows the questions folded, on the welcome screen and in About', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')

  // One list for both places.
  assert.match(screen, /import \{ PEERCHAT_QUESTIONS, PEERCHAT_WELCOME_QUESTIONS \} from '\.\/questions\.mjs'/)
  assert.doesNotMatch(screen, /const PEERCHAT_ABOUT = \[/)

  // On the welcome screen, under the four points, and the button comes after
  // them inside the scroll, so whoever agrees has gone past every question.
  const intro = screen.slice(screen.indexOf('if (showIntro) {'), screen.indexOf('if (isInitialized && !profile?.username)'))
  assert.match(intro, /<PeerChatQuestions colors=\{colors\} questions=\{PEERCHAT_WELCOME_QUESTIONS\} \/>/)
  assert.ok(intro.indexOf('PEERCHAT_INTRO_POINTS.map') < intro.indexOf('<PeerChatQuestions'))
  assert.ok(intro.indexOf('<PeerChatQuestions') < intro.indexOf('>I understand<'))
  assert.ok(intro.indexOf('>I understand<') < intro.indexOf('</ScrollView>'))

  const about = screen.slice(screen.indexOf('function PeerChatAboutPage'), screen.indexOf('function PeerChatMediaViewer'))
  assert.match(about, /<PeerChatQuestions colors=\{colors\} \/>/)
  assert.match(about, /No accounts, no servers, works\s+without internet, and every message is end to end encrypted/)

  // Folded: only the open question shows its answer, and a screen reader hears
  // whether it is open.
  const questions = screen.slice(screen.indexOf('function PeerChatQuestions'), screen.indexOf('function PeerChatAboutPage'))
  assert.match(questions, /accessibilityState=\{\{ expanded \}\}/)
  assert.match(questions, /\{expanded && <Text/)

  // Source code stays in settings, not buried in About.
  assert.doesNotMatch(about, /PEERCHAT_SOURCE_URL/)
  assert.match(screen, /setSettingsPage\('about'\)[\s\S]{0,900}PEERCHAT_SOURCE_URL/)

  // Opened as its own page inside the sheet. A second modal over the settings
  // sheet is what crashed iOS.
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
