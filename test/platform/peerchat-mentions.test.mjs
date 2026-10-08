import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  findMentions,
  mentionQueryStart,
  mentionsPerson,
  personName
} from '../../backend/peerchat/mentions.mjs'

// "@Akhilesh@mobile" stopped at the second "@" on both apps, so the phone's
// name was never a mention and its "@" broke the suggestions while typing.

test('PeerChat mentions name the person, whichever device was named', () => {
  assert.equal(personName('Akhilesh@mobile'), 'Akhilesh')
  assert.equal(personName('Akhilesh@desktop12'), 'Akhilesh')
  assert.equal(personName('Akhilesh Thite'), 'Akhilesh Thite')
  assert.equal(findMentions('@akhilesh@MOBILE', ['Akhilesh', 'Akhilesh@mobile'])[0].name, 'Akhilesh@mobile')
})

test('PeerChat mentions reach every device of the person named and nobody else', () => {
  const room = ['Akhilesh', 'Akhilesh@mobile', 'Akhilesh Thite', 'Sam']
  assert.equal(mentionsPerson('@Akhilesh@desktop1 look', room, ['Akhilesh', 'Akhilesh@mobile']), true)
  assert.equal(mentionsPerson('@Akhilesh look', room, ['Akhilesh', 'Akhilesh@mobile']), true)
  assert.equal(mentionsPerson('@Akhilesh Thite look', room, ['Akhilesh', 'Akhilesh@mobile']), false)
  assert.equal(mentionsPerson('mail me a@Akhilesh', room, ['Akhilesh', 'Akhilesh@mobile']), false)
})

test('PeerChat finds the mention being typed past a device label', () => {
  assert.equal(mentionQueryStart('hi @Akhilesh@mo'), 3)
  assert.equal(mentionQueryStart('@Akhilesh@'), 0)
  assert.equal(mentionQueryStart('hi @Akh'), 3)
  assert.equal(mentionQueryStart('mail a@b'), -1)
  assert.equal(mentionQueryStart('no mention'), -1)
})

test('PeerChat suggests and inserts mentions from where the mention starts', async () => {
  const screen = await readFile(new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url), 'utf8')
  const suggest = screen.slice(screen.indexOf('function getMentionCandidates ('), screen.indexOf('function insertMention ('))
  const insert = screen.slice(screen.indexOf('function insertMention ('), screen.indexOf('function formatMessageTime ('))
  assert.match(suggest, /mentionQueryStart\(composer\)/)
  assert.match(insert, /mentionQueryStart\(composer\)/)
  assert.doesNotMatch(suggest + insert, /lastIndexOf\('@'\)/)
})
