import assert from 'node:assert/strict'
import { test } from 'node:test'
import { publishMarkdownDocument } from '../../backend/hyper/drive.mjs'

function createDrive (id) {
  const files = new Map()
  return {
    id,
    files,
    async put (pathname, bytes) {
      files.set(pathname, Buffer.from(bytes).toString('utf8'))
    }
  }
}

function setup ({ linked = true } = {}) {
  const publicDrive = createDrive('p'.repeat(52))
  const privateDrive = createDrive('s'.repeat(52))
  const archived = []
  const asked = []
  const options = {
    runtime: {
      async getDrive (name) {
        asked.push(name)
        return publicDrive
      }
    },
    getSyncedPrivateDrive: async () => privateDrive,
    hasLinkedIdentity: () => linked,
    recordArchive: async (entry) => { archived.push(entry) }
  }
  return { publicDrive, privateDrive, archived, asked, options }
}

test('a public note goes to the P2PMD drive anyone with the link can read', async () => {
  const { publicDrive, privateDrive, archived, asked, options } = setup()

  const result = await publishMarkdownDocument({ content: '# Trip', visibility: 'public' }, options)

  assert.deepEqual(result, { ok: true, url: `hyper://${publicDrive.id}/`, visibility: 'public' })
  assert.deepEqual(asked, ['p2pmd'])
  assert.match(publicDrive.files.get('/index.html'), /<h1[^>]*>Trip<\/h1>/)
  assert.equal(privateDrive.files.size, 0)
  assert.deepEqual(archived, [{ url: `hyper://${publicDrive.id}/`, name: 'P2PMD', source: 'published', appId: 'p2pmd' }])
})

test('a note published without a choice stays public, as it was before', async () => {
  const { publicDrive, options } = setup()

  const result = await publishMarkdownDocument({ content: '# Trip' }, options)

  assert.equal(result.url, `hyper://${publicDrive.id}/`)
  assert.equal(result.visibility, 'public')
})

test('a private note goes to the private drive only linked devices can open', async () => {
  const { publicDrive, privateDrive, archived, asked, options } = setup()

  const result = await publishMarkdownDocument({ content: '# Trip\n\nPermit at 8', mode: 'note', visibility: 'private' }, options)

  const url = `hyper://${privateDrive.id}/p2pmd/index.html`
  assert.deepEqual(result, { ok: true, url, visibility: 'private' })
  assert.match(privateDrive.files.get('/p2pmd/index.html'), /Permit at 8/)
  // Nothing of it lands in the public drive.
  assert.deepEqual(asked, [])
  assert.equal(publicDrive.files.size, 0)
  assert.deepEqual(archived, [{ url, name: 'P2PMD (private)', source: 'published', appId: 'p2pmd' }])
})

test('a private note needs a linked identity, or no other device could open it', async () => {
  const { publicDrive, privateDrive, archived, options } = setup({ linked: false })

  const result = await publishMarkdownDocument({ content: '# Trip', visibility: 'private' }, options)

  assert.equal(result.ok, false)
  assert.match(result.error, /^Link PeerSky Desktop first\./)
  assert.match(result.error, /only your linked devices can open it/)
  assert.equal(privateDrive.files.size, 0)
  assert.equal(publicDrive.files.size, 0)
  assert.deepEqual(archived, [])
})

test('private slides are published the same way', async () => {
  const { privateDrive, options } = setup()

  const result = await publishMarkdownDocument({ content: '# One\n\n---\n\n# Two', mode: 'slides', visibility: 'private' }, options)

  assert.equal(result.ok, true)
  assert.match(privateDrive.files.get('/p2pmd/index.html'), /One/)
  assert.match(privateDrive.files.get('/p2pmd/index.html'), /Two/)
})
