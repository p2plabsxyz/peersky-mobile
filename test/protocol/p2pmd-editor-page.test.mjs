import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getP2pmdEditorPage } from '../../backend/p2pmd/server.mjs'

describe('p2pmd mobile editor page routing', () => {
  it('routes collaboration endpoints through the joined room base URL', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /fetch\(roomUrl\('\/doc'\)\)/)
    assert.match(html, /fetch\(roomUrl\('\/doc\/update'\)/)
    assert.match(html, /fetch\(roomUrl\('\/doc\/yjsstate'\)\)/)
    assert.match(html, /new EventSource\(roomUrl\('\/events\?'/)
    assert.match(html, /loadScript\(roomUrl\('\/lib\/yjs\.min\.js'\)\)/)
    assert.match(html, /withInitialRoomRetry/)
    assert.match(html, /INITIAL_ROOM_RETRY_ATTEMPTS/)
  })

  it('keeps preview and Hyper image upload on the mobile native bridge', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /callNativeBridge\('preview'/)
    assert.match(html, /callNativeBridge\('hyper-image'/)
    assert.match(html, /readAsDataURL\(file\)/)
    assert.match(html, /window\.__p2pmdResolveBridgeRequest/)
    assert.doesNotMatch(html, /fetch\(roomUrl\('\/preview'/)
    assert.doesNotMatch(html, /fetch\(roomUrl\('\/hyper\/image'/)
    assert.doesNotMatch(html, /await .*\.arrayBuffer\(\)/)
  })
})
