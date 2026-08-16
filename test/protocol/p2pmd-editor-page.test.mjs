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

  it('provides mobile slide controls through the shared editor page', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /data-format="slides"/)
    assert.match(html, /callNativeBridge\('preview', \{\s+content: input\.value,\s+mode: 'slides'/)
    assert.match(html, /notifyNative\('p2pmd-view-mode', \{ mode: viewMode \}\)/)
    assert.match(html, /slidesPreview\.addEventListener\('touchstart'/)
    assert.match(html, /Math\.abs\(deltaX\) < 48/)
    assert.match(html, /event\.key === 'ArrowRight'/)
    assert.match(html, /renderActiveView\(\)/)
    assert.match(html, /scheduleActiveViewRender\(\)/)
    assert.match(html, /ACTIVE_VIEW_RENDER_DELAY_MS = 120/)
    assert.match(html, /currentSlideIndex === previousSlideIndex \? previousScrollTop : 0/)
    assert.match(html, /if \(nextSlideIndex < 0 \|\| nextSlideIndex >= slideCount\) return/)
    assert.match(html, /function fitActiveSlide\(\)/)
    assert.match(html, /window\.matchMedia\('\(orientation: landscape\)'\)/)
    assert.match(html, /Math\.min\(1, availableWidth \/ contentWidth, availableHeight \/ contentHeight\)/)
    assert.match(html, /window\.addEventListener\('resize', scheduleSlideFit\)/)
    assert.match(html, /event\.key === 'Escape'\) setViewMode\('edit'\)/)
    assert.match(html, /aria-label="Previous slide"/)
    assert.match(html, /aria-label="Exit presentation"/)
    assert.match(html, /slidesExit\.addEventListener\('click', \(\) => setViewMode\('edit'\)\)/)
    assert.match(html, /id="slides-progress-value"/)
    assert.match(html, /mode: viewMode/)
  })
})
