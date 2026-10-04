import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

// App Store guideline 5.2.5 turns down apps that look like an Apple product.
// PeerTunes keeps its player shell, but none of Apple's product names, in
// what people see or in the code behind it.
test('PeerTunes does not use Apple product names', async () => {
  const root = new URL('../../assets/peertunes/', import.meta.url)
  const files = (await readdir(root, { recursive: true })).filter((name) => /\.(html|css|js|json|webmanifest)$/.test(name))
  assert.ok(files.length > 5)
  for (const file of files) {
    const text = await readFile(new URL(file, root), 'utf8')
    assert.doesNotMatch(text, /\bipod\b|click ?wheel|cover ?flow/i, file)
  }
  const runtime = await readFile(new URL('../../backend/peertunes/peertunes-runtime.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(runtime, /\bipod\b|click ?wheel|cover ?flow/i)
})
