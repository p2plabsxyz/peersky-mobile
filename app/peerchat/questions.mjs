import { msg } from '../i18n/i18n.mjs'

// What people ask about PeerChat, as dropdowns. The first list is for someone
// who has not used it yet and shows on the welcome screen. About shows both.
// Written for someone who has never heard of peer to peer, in our own words
// rather than another chat app's, and the awkward ones get a straight answer.
export const PEERCHAT_WELCOME_QUESTIONS = [
  {
    q: msg('What is PeerChat?'),
    a: msg('Group chats and one to one chats that run on your own devices, not on a company’s servers. Make a room, share its link with friends, and your devices talk to each other directly, end to end encrypted. It comes built into PeerSky, on phones and computers.')
  },
  {
    q: msg('How does it compare with WhatsApp, Telegram or Signal?'),
    a: msg('Those apps carry every message through servers their company runs, and they sign you up with a phone number. PeerChat has neither. Messages go straight from your device to your friends’, end to end encrypted, and it keeps working on a local network with no internet. If you need protection from a powerful adversary, Signal is built for that. PeerChat is for friends and teams who would rather have nobody in the middle.')
  },
  {
    q: msg('Do I have to give a phone number or email?'),
    a: msg('No. Pick a name and you’re in. There is no account on a server, so your name lives on your device, not in anyone’s database.')
  },
  {
    q: msg('Then how do my friends find me?'),
    a: msg('Through a room. Share its invite link, QR code or key, and anyone who has it can join and see who’s there. To talk to one person alone, open their profile in a room you share.')
  },
  {
    q: msg('What does peer to peer mean for my chats?'),
    a: msg('Your device talks to your friends’ devices directly instead of going through a company’s computers. With no server keeping everyone’s chats, there is nothing to hack, leak, sell or switch off. The one catch: both of you need to be online at the same time for a message to arrive.')
  },
  {
    q: msg('How does it work without internet?'),
    a: msg('Devices on the same Wi-Fi find each other and talk directly, so there is nothing out on the internet to reach. Any local network will do, even a phone’s hotspot with no data behind it: at a festival, in a power cut, or wherever the internet is down or blocked. Some public Wi-Fi keeps devices apart, and there a hotspot works instead. When you are online, the same rooms reach friends anywhere.')
  },
  {
    q: msg('How private is it?'),
    a: msg('Everything you send, files included, is encrypted on your device before it leaves, and only the people in the room can open it. In a room made on this version the key changes every hour, so someone who gets a room’s key later cannot read what was said before. Every message carries its sender’s signature, so nobody can fake one from you, even when another device in the room passes it on. A device has to prove it has the key before yours tells it anything about the room. We collect nothing about you: no tracking, no analytics. Two things to know: people in a chat with you can see your network address, because your device talks to theirs, and a room key never expires, so share it like a house key.')
  },
  {
    q: msg('Who can see my IP address?'),
    a: msg('Anyone your device connects to directly: the people you chat with, and the devices on the network that help peers find each other. That is how peer to peer works, and most apps are the same: even Signal’s servers see your IP address. To keep it from all of them, turn on a VPN. People then see the VPN’s address, not yours.')
  },
  {
    q: msg('What does it cost?'),
    a: msg('Nothing. There are no ads, no subscriptions and no premium tier. With no servers there is no bill to pass on to you and no data to sell. PeerChat is open source, so anyone can read exactly what it does.')
  },
  {
    q: msg('Can I send big files?'),
    a: msg('Yes, any size your phone has room for: photos, films, whole folders zipped up. Nothing is uploaded to a server and squeezed. Your friends download it straight from your device, encrypted like your messages, so keep PeerSky open until they have it.')
  },
  {
    q: msg('Is it available on desktop?'),
    a: msg('Yes. PeerChat is built into PeerSky for Mac, Windows and Linux, with the same rooms as on your phone, so friends on phones and computers chat together.')
  },
  {
    q: msg('Can I use it on my phone and my computer?'),
    a: msg('Yes, on one phone and as many computers as you like, all at the same time. Link them with Link Device in PeerSky’s settings. Each one shows your name with a fixed label, like ada@mobile or ada@desktop1, and messages reach all of them. Rename yourself on one and the others follow, and a room you join on one shows up on the rest. Moving to a new phone is a deliberate step: remove the identity from the old one first.')
  },
  {
    q: msg('Who makes PeerChat?'),
    a: msg('P2P Labs, the team behind PeerSky. Nobody owns your chats, us included: they live on your devices. The code is open source on GitHub for anyone to check.')
  }
]

// What comes up once people are chatting.
export const PEERCHAT_USAGE_QUESTIONS = [
  {
    q: msg('Why didn’t my message arrive?'),
    a: msg('Messages hop straight between devices, so both of you need to be online at the same time. Nothing waits on a server while you’re away. Keep PeerSky running in the background so friends can reach you, and what was said in a room while you were gone comes through once you’re both back.')
  },
  {
    q: msg('Could a stranger on the network sneak into my room?'),
    a: msg('Not without the key. Devices find a room by an address anyone on the network can see, so knowing that address gets nobody in. Before your device shares anything about a room, the other side has to prove it holds the room’s key, and the key itself never goes over the wire.')
  },
  {
    q: msg('What about one to one chats?'),
    a: msg('Each one gets its own key, made fresh for that conversation, so it can’t be worked out from your name or your code. It goes only to the person you’re messaging, checked against the key their device proved when it connected, so a lookalike can’t catch it.')
  },
  {
    q: msg('Can I unsend a message?'),
    a: msg('No. Once it arrives it’s on their device, and their device is theirs. It works like a text message, so give it a second look before you send.')
  },
  {
    q: msg('Why can’t I see older messages?'),
    a: msg('You start fresh from the moment you join, so nobody’s old conversation follows them around.')
  },
  {
    q: msg('Can somebody be kicked out of a room?'),
    a: msg('Whoever made the room can remove anyone in it, and nobody else can. Every copy of PeerChat checks a removal against the key of the room’s maker. The room also moves to a new key for the people still in it, so invites from before stop working. If the person you remove uses PeerChat on another device too, remove that one as well. Anyone on an older version of PeerSky stays on the old key until they update, and P2P Republic keeps its key, since it ships with the app. The three strikes spam and abuse limit is separate: that one is a five minute pause.')
  },
  {
    q: msg('Can people send anything they like?'),
    a: msg('In groups, some checks are always on. Nudity in pictures is refused before it’s sent, and a picture that looks explicit when it arrives is hidden behind a warning. Links to adult sites are blocked. Text is also filtered for abuse and slurs, and whoever made the group can turn those two filters off. A link that looks like a scam gets a warning. All of this happens on your phone, and nothing about it is sent to us.')
  },
  {
    q: msg('Someone is bothering me. What can I do?'),
    a: msg('Press and hold one of their messages, or open their profile, and tap Block. Everything they send disappears for you, in every chat, and they can’t message you directly. Report sends the people who build PeerChat an email about it, with the message you reported. The email doesn’t let us into your chats, and we can’t delete anything. We can remove people only from P2P Republic, the room we run. In any other group, only whoever made it can do that.')
  },
  {
    q: msg('How do I delete my account?'),
    a: msg('There’s no account on a server, but you can delete your profile: in PeerChat settings, tap Delete PeerChat profile. Your name, chats and files are gone from this device, and every room sees you leave. Anything you already sent stays with the people you sent it to.')
  }
]

export const PEERCHAT_QUESTIONS = [...PEERCHAT_WELCOME_QUESTIONS, ...PEERCHAT_USAGE_QUESTIONS]
