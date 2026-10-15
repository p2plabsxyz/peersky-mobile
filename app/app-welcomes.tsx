import type { AppWelcomeContent } from './AppWelcome'
import { msg } from './i18n/i18n.mjs'
import DownloadIcon from '../assets/icons/bootstrap/download.svg'
import GlobeIcon from '../assets/icons/bootstrap/globe.svg'
import PeopleIcon from '../assets/icons/bootstrap/people.svg'
import PhoneIcon from '../assets/icons/bootstrap/phone.svg'
import QrIcon from '../assets/icons/bootstrap/qr-code-scan.svg'
import ShieldLockIcon from '../assets/icons/bootstrap/shield-lock.svg'

// Written for somebody who has never heard of Markdown on a phone, let alone
// Holesail or Yjs, so none of that appears here.
export const P2PMD_WELCOME: AppWelcomeContent = {
  icon: require('../assets/images/p2pmd.png'),
  title: 'P2PMD',
  lead: msg('Markdown notes you write together, live, straight between devices.'),
  points: [
    {
      id: 'together',
      Icon: PeopleIcon,
      title: msg('Write together, live'),
      body: msg('Send a note’s key, and everyone edits the same note at the same time.')
    },
    {
      id: 'server',
      Icon: PhoneIcon,
      title: msg('Your phone is the server'),
      body: msg('Notes you make are hosted right here. Keep PeerSky open while others write with you.')
    },
    {
      id: 'private',
      Icon: ShieldLockIcon,
      title: msg('Private from the start'),
      body: msg('Every new note is private: only people you give its key to can open it.')
    },
    {
      id: 'share',
      Icon: GlobeIcon,
      title: msg('Slides and links'),
      body: msg('Put --- between parts to show them as slides, and publish a note as a link anyone can open.')
    }
  ],
  action: msg('Start writing')
}

// The same words the screen itself uses (Private, This device only, Keep
// offline), so the welcome and the buttons after it agree.
export const HYPERDRIVE_WELCOME: AppWelcomeContent = {
  icon: require('../assets/images/hyperdrive.png'),
  title: 'Hyperdrive',
  lead: msg('Your files, shared straight from this phone.'),
  points: [
    {
      id: 'share',
      Icon: GlobeIcon,
      title: msg('Share with a link'),
      body: msg('Upload a file and send its link. People open it straight from your phone, with no server in between.')
    },
    {
      id: 'private',
      Icon: ShieldLockIcon,
      title: msg('Private when you want'),
      body: msg('Private files are encrypted, so only your linked devices can open them, and they show up there on their own. This device only keeps a file here and never syncs it.')
    },
    {
      id: 'offline',
      Icon: DownloadIcon,
      title: msg('Keep folders offline'),
      body: msg('Fetch a folder someone shared and keep it, so it opens with no connection.')
    },
    {
      id: 'open',
      Icon: QrIcon,
      title: msg('Open what others share'),
      body: msg('Paste a link or scan a QR code to fetch files from another device.')
    }
  ],
  action: msg('Get started')
}
