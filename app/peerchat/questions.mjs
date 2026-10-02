// What people ask about PeerChat, as dropdowns. The first list is for someone
// who has not used it yet and shows on the welcome screen. About shows both.
// Written for someone who has never heard of peer to peer, and the awkward
// ones get a straight answer.
export const PEERCHAT_WELCOME_QUESTIONS = [
  {
    q: 'What is PeerChat?',
    a: 'Group chats and one to one chats that run on your own devices. You make a room, share its key with friends, and your phones talk to each other directly. It comes with PeerSky, on phones and computers.'
  },
  {
    q: 'How is it different from WhatsApp, Telegram or Signal?',
    a: 'Those apps send your messages through servers their company runs, and they all sign you up with a phone number. PeerChat has neither. Messages go straight from your device to your friends’, end to end encrypted, and it keeps working on a local network with no internet. If you need protection from a powerful adversary, Signal is built for that. PeerChat is for friends and teams who would rather have nobody in the middle.'
  },
  {
    q: 'Do I need a phone number or an email?',
    a: 'No. Pick a name and you’re in. Your name lives on your device, not in anyone’s database.'
  },
  {
    q: 'Then how do my friends find me?',
    a: 'Through a room. Share its invite link, QR code or key, and anyone who has it can join and see who’s there. To talk to one person alone, open their profile in a room you share.'
  },
  {
    q: 'What does peer to peer mean, and why does it matter?',
    a: 'Your device talks to theirs directly instead of going through a company’s computers. With no server keeping everyone’s chats, there is nothing to hack, leak, sell or switch off. The one catch: both of you need to be online at the same time for a message to arrive.'
  },
  {
    q: 'How private is it?',
    a: 'Everything you send, files included, is encrypted on your device with the room’s key before it leaves, and only the people in the room hold that key. A device has to prove it has the key before yours tells it anything about the room. We collect nothing about you: no tracking, no analytics. Two things to know: people in a chat with you can see your network address, because your device talks to theirs, and a room key never expires, so share it like a house key.'
  },
  {
    q: 'Is it really free? Any ads or subscriptions?',
    a: 'Free, with no ads, no subscriptions and no premium tier. There is no server bill to pass on to you and no data to sell. PeerChat is open source, so anyone can read exactly what it does.'
  },
  {
    q: 'Can I send big files?',
    a: 'Yes, up to 2 GB each: photos, videos, documents, anything. They’re encrypted like your messages, and your friends download them from your device, so keep PeerSky open until they have it.'
  },
  {
    q: 'Can I use it on my phone and my computer?',
    a: 'Yes, on one phone and as many computers as you like, all at the same time. Link them with Link Device in PeerSky’s settings. Each one shows your name with a fixed label, like ada@mobile or ada@desktop1, and messages reach all of them. Rename yourself on one and the others follow, and a room you join on one shows up on the rest. Moving to a new phone is a deliberate step: remove the identity from the old one first.'
  },
  {
    q: 'Is it on iPhone and Android?',
    a: 'Yes. PeerChat is part of PeerSky on iPhone, iPad and Android, and on Mac, Windows and Linux. Everyone chats in the same rooms, whatever they use.'
  },
  {
    q: 'Who makes PeerChat?',
    a: 'P2P Labs, the team behind PeerSky. Nobody owns your chats, us included: they live on your devices. The code is open source on GitHub for anyone to check.'
  }
]

// What comes up once people are chatting.
export const PEERCHAT_USAGE_QUESTIONS = [
  {
    q: 'Does it work without internet?',
    a: 'Yes. Any local network will do, even a phone hotspot. When the internet is cut off, or never reached you in the first place, PeerChat keeps working.'
  },
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
