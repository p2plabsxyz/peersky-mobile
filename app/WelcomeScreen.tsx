import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BROWSER_PALETTES } from './browser-appearance.mjs'
import GlobeIcon from '../assets/icons/bootstrap/globe.svg'
import DatabaseIcon from '../assets/icons/bootstrap/database.svg'
import ShieldLockIcon from '../assets/icons/bootstrap/shield-lock.svg'
import PeopleIcon from '../assets/icons/bootstrap/people.svg'

const PEERSKY_ICON = require('../assets/images/app-icon-transparent.png')

// Four things worth knowing before the first page loads, and nothing else. A
// tour is something to escape from; this is one screen with one button.
const QUALITIES = [
  {
    id: 'p2p',
    Icon: GlobeIcon,
    title: 'Every site, plus peer to peer ones',
    body: 'Normal websites work exactly as they do anywhere else. PeerSky also opens pages shared straight from other people’s devices, which keep working when the internet does not.'
  },
  {
    id: 'yours',
    Icon: DatabaseIcon,
    title: 'We know nothing about you',
    body: 'Nothing about you is sent to us, because there is nowhere to send it. Your tabs, files, messages and keys stay on this phone, and Settings lets you delete any of them.'
  },
  {
    id: 'clean',
    Icon: ShieldLockIcon,
    title: 'No ads, no trackers, no account',
    body: 'Ads and trackers are blocked before a page can load them. There is nothing to sign up for, and nothing about you is collected.'
  },
  {
    id: 'together',
    Icon: PeopleIcon,
    title: 'Chat and share, device to device',
    body: 'Messages, notes and music go straight from your phone to theirs, encrypted the whole way. No server keeps a copy, because there is no server.'
  }
]

export function WelcomeScreen ({ isDark, onDone }: { isDark: boolean, onDone: () => void }) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: palette.shell }]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Image source={PEERSKY_ICON} style={styles.logo} />
        <Text style={[styles.title, { color: palette.text }]}>PeerSky</Text>
        <Text style={[styles.lead, { color: palette.mutedText }]}>
          A peer to peer, surveillance free browser.
        </Text>

        <View style={styles.qualities}>
          {QUALITIES.map(({ id, Icon, title, body }) => (
            <View key={id} style={styles.quality}>
              <View style={[styles.qualityIcon, { backgroundColor: palette.selectedBackground }]}>
                <Icon width={20} height={20} color={palette.selectedControl} />
              </View>
              <View style={styles.qualityCopy}>
                <Text style={[styles.qualityTitle, { color: palette.text }]}>{title}</Text>
                <Text style={[styles.qualityBody, { color: palette.mutedText }]}>{body}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Start browsing'
        onPress={onDone}
        style={({ pressed }) => [styles.start, pressed ? styles.startPressed : null]}
      >
        <Text style={styles.startText}>Start browsing</Text>
      </Pressable>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 32
  },
  logo: { alignSelf: 'center', height: 86, width: 86 },
  title: {
    fontSize: 30,
    fontWeight: '900',
    marginTop: 14,
    textAlign: 'center'
  },
  lead: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center'
  },
  qualities: { gap: 22, marginTop: 32 },
  quality: { flexDirection: 'row', gap: 14 },
  qualityIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  qualityCopy: { flex: 1, gap: 4 },
  qualityTitle: { fontSize: 15, fontWeight: '800' },
  qualityBody: { fontSize: 13, lineHeight: 19 },
  start: {
    alignItems: 'center',
    backgroundColor: '#1f6fd1',
    borderRadius: 14,
    justifyContent: 'center',
    marginBottom: 10,
    marginHorizontal: 26,
    minHeight: 52
  },
  startPressed: { opacity: 0.8 },
  startText: { color: '#ffffff', fontSize: 16, fontWeight: '800' }
})
