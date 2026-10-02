import type { AppWelcomeContent } from './AppWelcome'
import GlobeIcon from '../assets/icons/bootstrap/globe.svg'
import PeopleIcon from '../assets/icons/bootstrap/people.svg'
import PhoneIcon from '../assets/icons/bootstrap/phone.svg'
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
