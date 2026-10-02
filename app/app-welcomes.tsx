import type { AppWelcomeContent } from './AppWelcome'
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
  lead: 'Markdown notes you write together, live, straight between devices.',
  points: [
    {
      id: 'together',
      Icon: PeopleIcon,
      title: 'Write together, live',
      body: 'Send a note’s key, and everyone edits the same note at the same time.'
    },
    {
      id: 'server',
      Icon: PhoneIcon,
      title: 'Your phone is the server',
      body: 'Notes you make are hosted right here. Keep PeerSky open while others write with you.'
    },
    {
      id: 'private',
      Icon: ShieldLockIcon,
      title: 'Private from the start',
      body: 'Every new note is private: only people you give its key to can open it.'
    },
    {
      id: 'share',
      Icon: GlobeIcon,
      title: 'Slides and links',
      body: 'Put --- between parts to show them as slides, and publish a note as a link anyone can open.'
    }
  ],
  action: 'Start writing'
}

// The same words the screen itself uses (Private, This device only, Keep
// offline), so the welcome and the buttons after it agree.
export const HYPERDRIVE_WELCOME: AppWelcomeContent = {
  icon: require('../assets/images/hyperdrive.png'),
  title: 'Hyperdrive',
  lead: 'Your files, shared straight from this phone.',
  points: [
    {
      id: 'share',
      Icon: GlobeIcon,
      title: 'Share with a link',
      body: 'Upload a file and send its link. People open it straight from your phone, with no server in between.'
    },
    {
      id: 'private',
      Icon: ShieldLockIcon,
      title: 'Private when you want',
      body: 'Private files are encrypted, so only your linked devices can open them. This device only keeps a file here and never syncs it.'
    },
    {
      id: 'offline',
      Icon: DownloadIcon,
      title: 'Keep folders offline',
      body: 'Fetch a folder someone shared and keep it, so it opens with no connection.'
    },
    {
      id: 'open',
      Icon: QrIcon,
      title: 'Open what others share',
      body: 'Paste a link or scan a QR code to fetch files from another device.'
    }
  ],
  action: 'Get started'
}
