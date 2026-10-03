// What people ask about PeerChat, as dropdowns. The first list is for someone
// who has not used it yet and shows on the welcome screen. About shows both.
// Written for someone who has never heard of peer to peer, in our own words
// rather than another chat app's, and the awkward ones get a straight answer.
export const PEERCHAT_WELCOME_QUESTIONS = [
  {
    q: 'What is PeerChat?',
    a: 'A chat app that runs on your own devices instead of a company’s servers. Make a room, share its link with friends, and your messages go straight from your device to theirs, end to end encrypted. It comes built into PeerSky.'
  },
  {
    q: 'Where do my chats live?',
    a: 'On your devices, and nowhere else. No company computer keeps everyone’s conversations, so there is nothing to hack, leak, sell or switch off. That is what peer to peer means: your device talks to your friends’ devices directly. The one catch is that you both need to be online at the same time for a message to arrive.'
  },
  {
    q: 'Who can read my messages?',
    a: 'Only the people in the room. Everything you send, files too, is encrypted on your device with the room’s key, and only people who hold that key can open it. A device has to prove it has the key before yours tells it anything about the room. We collect nothing about you: no tracking, no analytics. Two things to know: people you chat with can see your network address, because your device connects to theirs, and a room key never expires, so share it like a house key.'
  },
  {
    q: 'Why don’t I need an account?',
    a: 'Because there is no server to sign in to. Pick a name and you’re in. Your name and your chats live on your device, not in anyone’s database, so there is no phone number or email to hand over.'
  },
  {
    q: 'How do I find my friends?',
    a: 'Through a room. Share its invite link, QR code or key, and anyone who has it can join and see who’s there. To talk to one person alone, open their profile in a room you share.'
  },
  {
    q: 'How does it work without internet?',
    a: 'Devices on the same Wi-Fi find each other and talk directly, so there is nothing out on the internet to reach. Any local network will do, even a phone’s hotspot with no data behind it: at a festival, in a power cut, or wherever the internet is down or blocked. Some public Wi-Fi keeps devices apart, and there a hotspot works instead. When you are online, the same rooms reach friends anywhere.'
  },
  {
    q: 'Is it on my computer too?',
    a: 'Yes. PeerChat is built into PeerSky for Mac, Windows and Linux. Use it on one phone and as many computers as you like, all at the same time: link them with Link Device in PeerSky’s settings and they share your name and your rooms. Each shows up with its own label, like ada@mobile or ada@desktop1, and messages reach all of them. Moving to a new phone is a deliberate step: remove the identity from the old one first.'
  },
  {
    q: 'How big a file can I send?',
    a: 'Any size your phone has room for: photos, films, whole folders zipped up. Nothing is uploaded to a server and squeezed. Your friends download it straight from your device, encrypted like your messages, so keep PeerSky open until they have it.'
  },
  {
    q: 'Why not just use WhatsApp or Signal?',
    a: 'Use whatever works for you. Those apps carry every message through servers their company runs, and they sign you up with a phone number. PeerChat has neither: messages go straight between devices, end to end encrypted, and it keeps working on a local network with no internet. If you need protection from a powerful adversary, Signal is built for that. PeerChat is for friends and teams who would rather have nobody in the middle.'
  },
  {
    q: 'What’s the catch?',
    a: 'There isn’t one. PeerChat is free, with no ads, no subscriptions and nothing to upgrade to. With no servers there is no bill to pass on and no data to sell. It is made by P2P Labs, the team behind PeerSky, and it is open source, so anyone can check that it does what this page says.'
  }
]

// What comes up once people are chatting.
export const PEERCHAT_USAGE_QUESTIONS = [
  {
    q: 'Why didn’t my message arrive?',
    a: 'Messages hop straight between devices, so both of you need to be online at the same time. Nothing waits on a server while you’re away. Keep PeerSky running in the background so friends can reach you, and what was said in a room while you were gone comes through once you’re both back.'
  },
  {
    q: 'Could a stranger on the network sneak into my room?',
    a: 'Not without the key. Devices find a room by an address anyone on the network can see, so knowing that address gets nobody in. Before your device shares anything about a room, the other side has to prove it holds the room’s key, and the key itself never goes over the wire.'
  },
  {
    q: 'What about one to one chats?',
    a: 'Each one gets its own key, made fresh for that conversation, so it can’t be worked out from your name or your code. It goes only to the person you’re messaging, checked against the key their device proved when it connected, so a lookalike can’t catch it.'
  },
  {
    q: 'Can I unsend a message?',
    a: 'No. Once it arrives it’s on their device, and their device is theirs. It works like a text message, so give it a second look before you send.'
  },
  {
    q: 'Why can’t I see older messages?',
    a: 'You start fresh from the moment you join, so nobody’s old conversation follows them around.'
  },
  {
    q: 'Can somebody be kicked out of a room?',
    a: 'Whoever made the room can remove anyone in it, and nobody else can. Every copy of PeerChat checks the removal really came from the room’s maker, so it can’t be faked. What it can’t do is take the room key back, so someone removed could still listen with a changed app. For a clean slate, make a new room. The three strikes spam and abuse limit is separate: that one is a five minute pause.'
  },
  {
    q: 'Can people send anything they like?',
    a: 'Some things are blocked for everyone, with nothing to switch on. Nudity in pictures is refused before it’s sent and again when it arrives. Text is filtered for abuse, slurs and adult links, and a link that looks like a scam gets a warning. Violent or graphic pictures aren’t detected, so block and report are there for those.'
  },
  {
    q: 'Someone is bothering me. What can I do?',
    a: 'Press and hold one of their messages, or open their profile, and tap Block. Everything they send disappears for you, in every chat, and they can’t message you directly. Report sends the people who build PeerChat an email about it, with the message you reported.'
  },
  {
    q: 'How do I delete my account?',
    a: 'There’s no account on a server, but you can delete your profile: in PeerChat settings, tap Delete PeerChat profile. Your name, chats and files are gone from this device, and every room sees you leave. Anything you already sent stays with the people you sent it to.'
  }
]

export const PEERCHAT_QUESTIONS = [...PEERCHAT_WELCOME_QUESTIONS, ...PEERCHAT_USAGE_QUESTIONS]
