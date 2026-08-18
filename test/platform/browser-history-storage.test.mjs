import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  readBrowserHistoryFile,
  replaceBrowserHistoryFile
} from '../../app/history/browser-history-storage.mjs'

describe('browser history storage', () => {
  test('rejects oversized and malformed persisted history before restoration', async () => {
    const oversized = createMemoryFiles({ '/history': 'x'.repeat(20) })
    assert.equal((await readBrowserHistoryFile(oversized.file('/history'), 10)).ok, false)

    const malformed = createMemoryFiles({ '/history': '{invalid' })
    const result = await readBrowserHistoryFile(malformed.file('/history'))
    assert.equal(result.ok, false)
    assert.match(result.error, /malformed/)
  })

  test('atomically replaces persisted history and removes temporary files', async () => {
    const files = createMemoryFiles({ '/history': '{"items":[]}' })
    replaceBrowserHistoryFile({
      activeUri: '/history',
      backupUri: '/history.backup',
      temporaryUri: '/history.temporary',
      createFile: files.file
    }, '{"items":[{"url":"https://example.com/","title":"Example","visitedAt":1}]}')

    assert.match(await files.file('/history').text(), /example[.]com/)
    assert.equal(files.file('/history.backup').exists, false)
    assert.equal(files.file('/history.temporary').exists, false)
  })

  test('restores the previous file if replacement fails', async () => {
    const files = createMemoryFiles({ '/history': 'previous' }, '/history.temporary')

    assert.throws(() => replaceBrowserHistoryFile({
      activeUri: '/history',
      backupUri: '/history.backup',
      temporaryUri: '/history.temporary',
      createFile: files.file
    }, 'next'))

    assert.equal(await files.file('/history').text(), 'previous')
  })
})

function createMemoryFiles (initial = {}, failMoveFrom = null) {
  const values = new Map(Object.entries(initial))

  class MemoryFile {
    constructor (uri) {
      this.uri = uri
    }

    get exists () {
      return values.has(this.uri)
    }

    get size () {
      return this.exists ? Buffer.byteLength(values.get(this.uri)) : 0
    }

    async text () {
      return values.get(this.uri)
    }

    create () {
      if (this.exists) throw new Error('File exists')
      values.set(this.uri, '')
    }

    delete () {
      values.delete(this.uri)
    }

    move (destination) {
      if (this.uri === failMoveFrom) throw new Error('Move failed')
      const value = values.get(this.uri)
      if (value === undefined) throw new Error('Missing source')
      values.delete(this.uri)
      values.set(destination.uri, value)
      this.uri = destination.uri
    }

    write (value) {
      values.set(this.uri, value)
    }
  }

  return {
    file: (uri) => new MemoryFile(uri)
  }
}
