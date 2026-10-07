import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  collectPeerChatNotificationCandidates,
  DEFAULT_PEERCHAT_NOTIFICATION_PREFERENCES,
  MAX_PEERCHAT_NOTIFICATIONS_PER_POLL,
  parsePeerChatNotificationPreferences,
  serializePeerChatNotificationPreferences,
  shouldAskForPeerChatNotifications,
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

// PeerChat from Link Device or a restore never went through onboarding, which
// is where the system is asked. Notifications showed as on, Android had never
// been asked, and nothing arrived: the Play copy of a phone linked to its
// desktop got no banners at all.
test('PeerChat asks about notifications once when its profile came from another device', async () => {
  const ready = { asked: false, isPeerChatVisible: true, isReady: true, isRuntimeReady: true, notificationsEnabled: true, roomCount: 2 }
  assert.equal(shouldAskForPeerChatNotifications(ready), true)
  assert.equal(shouldAskForPeerChatNotifications({ ...ready, asked: true }), false)
  assert.equal(shouldAskForPeerChatNotifications({ ...ready, isPeerChatVisible: false }), false)
  assert.equal(shouldAskForPeerChatNotifications({ ...ready, roomCount: 0 }), false)
  // Turned off, or refused before: left alone.
  assert.equal(shouldAskForPeerChatNotifications({ ...ready, notificationsEnabled: false }), false)
  assert.equal(shouldAskForPeerChatNotifications({ ...ready, isRuntimeReady: false }), false)

  const hook = await readFile(new URL('../../app/peerchat/usePeerChatNotifications.ts', import.meta.url), 'utf8')
  assert.match(hook, /canAskForPeerChatNotifications\(\)\s+\.then\(\(canAsk\) => \(canAsk \? setNotificationsEnabled\(true\) : undefined\)\)/)
  const source = await readFile(new URL('../../app/peerchat/notifications.ts', import.meta.url), 'utf8')
  const canAsk = source.slice(source.indexOf('export async function canAskForPeerChatNotifications'), source.indexOf('// One prompt at a time.'))
  // Android 13 and newer call a permission never asked for denied.
  assert.match(canAsk, /permission\.canAskAgain !== false/)
  assert.doesNotMatch(canAsk, /UNDETERMINED|undetermined/)
  // One prompt, whoever asks.
  assert.match(source, /if \(!permissionAsking\) \{\s+permissionAsking = askForPeerChatNotificationPermission\(\)/)
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

// The count on the app icon went blank every time PeerSky opened, because the
// runtime starting up set it to 0, and stayed blank if you left before the
// first check. The messages were still unread. It stays until their room is
// opened, and the PeerChat shortcut starts from it rather than from nothing.
test('the unread count stays on the app icon until the chat is opened', async () => {
  const hook = await readFile(new URL('../../app/peerchat/usePeerChatNotifications.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(hook, /setPeerChatBadgeCount\(0\)/)
  assert.doesNotMatch(hook, /setUnreadTotal\(0\)/)
  const starting = hook.slice(hook.indexOf('if (!isReady || isRuntimeReady) return'), hook.indexOf('if (!isReady || !isRuntimeReady) {'))
  assert.match(starting, /badgeCountRef\.current = -1/)
  assert.match(hook, /void getPeerChatBadgeCount\(\)\.then\(\(count\) => \{\s+if \(!cancelled && badgeCountRef\.current === -1 && count > 0\) setUnreadTotal\(count\)/)

  // A room's count only clears when that room is opened, and it is saved.
  const service = await readFile(new URL('../../backend/peerchat/service.mjs', import.meta.url), 'utf8')
  const open = service.slice(service.indexOf('  setActiveRoom ({ roomKey } = {}) {'), service.indexOf('  async getSnapshot ('))
  assert.match(open, /room\.unreadCount = 0[\s\S]*this\.schedulePersist\(\)/)
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

  // Before using it: what it is, how it compares, how friends find you, what
  // peer to peer means, how it works offline, on desktop and on several
  // devices, and what it costs. Nothing about blocking people or deleting
  // things yet.
  for (const pattern of [/What is PeerChat/, /compare with WhatsApp, Telegram or Signal/, /phone number or email/, /friends find me/, /peer to peer mean/, /How does it work without internet/, /How private/, /Who can see my IP address/, /What does it cost/, /big files/, /available on desktop/, /phone and my computer/, /Who makes PeerChat/]) {
    assert.ok(PEERCHAT_WELCOME_QUESTIONS.some(({ q }) => pattern.test(q)), String(pattern))
  }
  for (const pattern of [/bothering me/, /delete my account/, /unsend/]) {
    assert.ok(!PEERCHAT_WELCOME_QUESTIONS.some(({ q }) => pattern.test(q)), String(pattern))
  }
  // In PeerChat's own words, not another chat app's FAQ word for word. "Is it
  // on iPhone and Android?" was one, and someone reading it inside the app has
  // the answer in their hand, so it asks about desktop instead.
  for (const pattern of [/iPhone and Android/, /Who owns/, /phone number to use/, /share large files/, /different from/, /really free/, /why does it matter/, /any ads or subscriptions/i, /multiple devices/]) {
    assert.ok(!PEERCHAT_QUESTIONS.some(({ q }) => pattern.test(q)), String(pattern))
  }
  // Offline is explained once, with the welcome questions.
  assert.equal(PEERCHAT_QUESTIONS.filter(({ q }) => /without internet/.test(q)).length, 1)

  // Straight about addresses: peers see it, as servers do in other apps, and a
  // VPN is what keeps it from all of them.
  assert.match(answer(/IP address/), /people you chat with/)
  assert.match(answer(/IP address/), /even Signal’s servers see your IP address/)
  assert.match(answer(/IP address/), /turn on a VPN/)

  // What PeerChat is, said outright: no accounts, no servers, works without
  // internet, end to end encrypted.
  assert.match(answer(/phone number or email/), /Pick a name and you.re in/)
  assert.match(answer(/compare with/), /end to end encrypted/)
  assert.match(answer(/without internet/), /Any local network will do/)
  assert.match(answer(/without internet/), /find each other and talk directly/)
  assert.match(answer(/without internet/), /Some public Wi-Fi keeps devices apart/)
  assert.match(answer(/What does it cost/), /no ads, no subscriptions/)
  assert.match(answer(/Who makes PeerChat/), /P2P Labs/)
  assert.match(answer(/big files/), /any size your phone has room for/)

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

  // On desktop too, and several devices at once, each with its label.
  assert.match(answer(/available on desktop/), /Mac, Windows and Linux/)
  assert.match(answer(/phone and my computer/), /as many computers as you like, all at the same time/)
  assert.match(answer(/phone and my computer/), /ada@mobile or ada@desktop1/)

  // Blocking and reporting say what they do, and the room key stays out of it.
  assert.match(answer(/bothering me/), /Everything they send disappears for you, in every chat/)
  assert.match(answer(/bothering me/), /with the message you reported/)
  assert.doesNotMatch(answer(/bothering me/), /key/)

  // What the filters catch, never what they miss: a list of gaps is a guide
  // for whoever wants to get something past them.
  for (const { a } of PEERCHAT_QUESTIONS) {
    assert.doesNotMatch(a, /(aren|isn).t detected|not detected|can.t (detect|tell)|undetected/i)
  }
  assert.match(answer(/send anything they like/), /Nudity in pictures is refused/)
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
