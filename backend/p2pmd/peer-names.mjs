// Two words a person can say out loud. A room full of "Mobile peer" told
// nobody who was who; "Sunny Otter" and "Brave Falcon" do, and they are easy
// to swap for a real name later.
//
// Every word is plain ASCII letters so the result also passes the stricter
// name rules elsewhere (letters, numbers and spaces only), and the longest
// pair stays well under the 32 characters P2PMD allows.
export const FUN_PEER_NAME_ADJECTIVES = [
  'Brave', 'Bright', 'Bouncy', 'Breezy', 'Calm', 'Cheery', 'Clever', 'Cosmic',
  'Cozy', 'Curious', 'Dapper', 'Dreamy', 'Eager', 'Fluffy', 'Friendly', 'Fuzzy',
  'Gentle', 'Giddy', 'Happy', 'Jolly', 'Kind', 'Lucky', 'Mellow', 'Merry',
  'Mighty', 'Nimble', 'Peppy', 'Plucky', 'Quick', 'Quiet', 'Rosy', 'Sleepy',
  'Snappy', 'Sparkly', 'Speedy', 'Sunny', 'Swift', 'Witty', 'Zany', 'Zesty'
]

export const FUN_PEER_NAME_ANIMALS = [
  'Badger', 'Beaver', 'Bison', 'Dolphin', 'Falcon', 'Ferret', 'Fox', 'Gecko',
  'Heron', 'Hedgehog', 'Koala', 'Kiwi', 'Lemur', 'Llama', 'Lynx', 'Moose',
  'Narwhal', 'Octopus', 'Otter', 'Owl', 'Panda', 'Penguin', 'Puffin', 'Quokka',
  'Raccoon', 'Robin', 'Seal', 'Sloth', 'Sparrow', 'Squid', 'Tiger', 'Toucan',
  'Turtle', 'Walrus', 'Wombat', 'Yak', 'Zebra'
]

export function createFunPeerName (random = Math.random) {
  return `${pick(FUN_PEER_NAME_ADJECTIVES, random)} ${pick(FUN_PEER_NAME_ANIMALS, random)}`
}

function pick (words, random) {
  const value = Number(random())
  const index = Number.isFinite(value) ? Math.floor(Math.abs(value) * words.length) : 0
  return words[Math.min(index, words.length - 1)]
}
