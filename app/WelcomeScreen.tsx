import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AppWelcome, type AppWelcomeContent } from './AppWelcome'
import { BROWSER_PALETTES } from './browser-appearance.mjs'
import DatabaseIcon from '../assets/icons/bootstrap/database.svg'
import FileCodeIcon from '../assets/icons/bootstrap/file-code.svg'
import GlobeIcon from '../assets/icons/bootstrap/globe.svg'
import GridIcon from '../assets/icons/bootstrap/grid.svg'
import PeopleIcon from '../assets/icons/bootstrap/people.svg'
import ShieldCheckIcon from '../assets/icons/bootstrap/shield-check.svg'

// What PeerSky stands for, before the first page loads: one screen, six
// short promises, one button. Each card is short enough to take in at a
// glance, and the web comes late because nobody needs convincing of it.
const QUALITIES = [
  {
    id: 'product',
    Icon: ShieldCheckIcon,
    title: 'You are not the product',
    body: 'No ads, no trackers, no account. We collect nothing about you, so there is nothing to sell.'
  },
  {
    id: 'everything',
    Icon: GridIcon,
    title: 'Everything in one app',
    body: 'Browser, chat, shared notes, music and file sharing, all built in. One app instead of five, with more on the way.'
  },
  {
    id: 'together',
    Icon: PeopleIcon,
    title: 'Device to device',
    body: 'What you share goes straight between phones and computers. There is no server. Your phone is the server.'
  },
  {
    id: 'yours',
    Icon: DatabaseIcon,
    title: 'Your data stays yours',
    body: 'Everything lives on this phone first, and keeps working over a local network even when the internet is down.'
  },
  {
    id: 'web',
    Icon: GlobeIcon,
    title: 'The whole web, minus the junk',
    body: 'Ads and trackers are blocked before they load. Normal sites work as usual, and so do sites that live on people’s devices.'
  },
  {
    id: 'open',
    Icon: FileCodeIcon,
    title: 'Free and open source',
    body: 'Anyone can read the code and check every promise on this screen.'
  }
]

const PEERSKY_WELCOME: AppWelcomeContent = {
  icon: require('../assets/images/logo.png'),
  title: 'PeerSky',
  lead: 'A browser that works for you, not for advertisers.',
  points: QUALITIES,
  action: 'Start exploring'
}

// The same screen the P2P apps greet with, full screen and with the same
// lines rising in one after another.
export function WelcomeScreen ({ isDark, onDone }: { isDark: boolean, onDone: () => void }) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light

  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={[styles.screen, { backgroundColor: palette.shell }]}
    >
      <AppWelcome content={PEERSKY_WELCOME} isDark={isDark} backgroundColor={palette.shell} onDone={onDone} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 }
})
