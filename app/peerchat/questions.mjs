// What people ask about PeerChat, as dropdowns on the welcome screen and in
// About. Written for someone who has never heard of peer to peer: every entry
// is a question a real person asks in the first week, in the words they would
// use. The awkward ones get a straight answer rather than a dodge, and each one
// leads with what you get before what you give up.
export const PEERCHAT_QUESTIONS = [
  {
    q: 'Do I really not need an account?',
    a: 'Really. Pick a name and start chatting. Nobody asks for your phone number or email, and your name lives on this phone, not in anyone’s database.'
  },
  {
    q: 'So where’s the server?',
    a: 'There isn’t one. Your phone talks straight to theirs, and no company sits in the middle holding your chats. There is no pile of everyone’s messages for anyone to leak or sell.'
  },
  {
    q: 'Who can actually read my messages?',
    a: 'Only the people in the conversation. Everything you send, pictures and files included, is end to end encrypted on your phone before it leaves, and only the people in the room hold the key. Anyone in between sees scrambled bytes.'
  },
  {
    q: 'Does it work without internet?',
    a: 'Yes. Any local network will do, even a phone hotspot. When the internet is cut off, or never reached you in the first place, PeerChat keeps working.'
  },
  {
    q: 'Could a stranger on the network sneak into my room?',
    a: 'Not without the key. Phones find a room by an address anyone on the network can see, so knowing that address gets nobody in. Before your phone shares anything about a room, the other side has to prove it holds the room’s key, and the key itself never goes over the wire.'
  },
  {
    q: 'What do you know about me?',
    a: 'Nothing. No tracking, no analytics, no profile of you on a server somewhere, because there is no server to keep one.'
  },
  {
    q: 'Why didn’t my message arrive?',
    a: 'Messages hop straight between devices, so both of you need to be online at the same time. Nothing waits on a server while you’re away. Keep PeerSky running in the background so friends can reach you, and what was said in a room while you were gone comes through once you’re both back.'
  },
  {
    q: 'How do people join my room?',
    a: 'Send them the invite link or the room key. Anyone who has it can get in, so share it the way you would a house key.'
  },
  {
    q: 'What about one to one chats?',
    a: 'Each one gets its own key, made fresh for that conversation, so it can’t be worked out from your name or your code. It goes only to the person you’re messaging, checked against the key their device proved when it connected, so a lookalike can’t catch it.'
  },
  {
    q: 'Can I use it on my phone and my computer?',
    a: 'Yes, on one phone and as many computers as you like, all at the same time. Link them with Link Device in PeerSky’s settings. Each one shows your name with a fixed label, like ada@mobile or ada@desktop1, and messages reach all of them. Rename yourself on one and the others follow, and a room you join on one shows up on the rest. Moving to a new phone is a deliberate step: remove the identity from the old one first.'
  },
  {
    q: 'How private is it, honestly?',
    a: 'Private enough for friends and teams, with two things worth knowing. People in a conversation with you can see your network address, because your phone talks to theirs directly. And a room key never expires, so anyone you gave it to can read that room for as long as they keep it. For something sensitive, start a fresh room and share its key with care.'
  },
  {
    q: 'Can I unsend a message?',
    a: 'No. Once it arrives it’s on their phone, and their phone is theirs. It works like a text message, so give it a second look before you send.'
  },
  {
    q: 'How do I delete my account?',
    a: 'There’s no account to delete, which is the good news. Clearing PeerSky data wipes your name and chats from this phone. Anything you already sent stays with the people you sent it to.'
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
  }
]
