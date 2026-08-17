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
    assert.match(html, /window\.addEventListener\('resize', \(\) =>/)
    assert.match(html, /event\.key === 'Escape'\) setViewMode\('edit'\)/)
    assert.match(html, /aria-label="Previous slide"/)
    assert.match(html, /aria-label="Exit presentation"/)
    assert.match(html, /slidesExit\.addEventListener\('click', \(\) => setViewMode\('edit'\)\)/)
    assert.match(html, /id="slides-progress-value"/)
    assert.match(html, /mode: viewMode/)
  })

  it('provides synchronized LaTeX mode and scientific templates', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /data-format="latex"/)
    assert.match(html, /data-format="inline-math"/)
    assert.match(html, /data-format="block-math"/)
    assert.match(html, /id="latex-template-menu"/)
    assert.match(html, /Research Paper/)
    assert.match(html, /Technical Documentation/)
    assert.match(html, /ydoc\.getMap\('settings'\)/)
    assert.match(html, /LATEX_MODE_YJS_KEY = 'latexModeEnabled'/)
    assert.match(html, /roomRole === 'host'/)
    assert.match(html, /latexModeEnabled/)
    assert.match(html, /window\.P2pmdIeee/)
    assert.doesNotMatch(html, /roomUrl\('\/lib\/ieee\.min\.js'\)/)
    assert.match(html, /window\.P2pmdIeee\.render\(preview, result\.html\)/)
    assert.match(html, /closeTemplateMenuOnOutsideClick/)
    assert.match(html, /event\.key === 'Escape'/)
  })

  it('keeps LaTeX mode host-controlled while clients consume shared state', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /latexModeButton\.disabled = roomRole !== 'host'/)
    assert.match(html, /if \(roomRole !== 'host' && !fromSharedState\) return false/)
    assert.match(html, /roomRole === 'host' && loadPersistedLatexMode\(\)/)
    assert.match(html, /persist: false, sync: false, fromSharedState: true/)
    assert.match(html, /if \(roomRole === 'host'\) setLatexMode\(true\)/)
  })

  it('serializes native preview rendering and coalesces newer requests', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /if \(activeViewRenderInFlight\) \{\s+activeViewRenderPending = true/)
    assert.match(html, /if \(viewMode === 'preview'\) await renderPreview\(\)/)
    assert.match(html, /if \(activeViewRenderPending\) \{/)
  })

  it('provides a mobile peer dashboard backed by shared room endpoints', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /id="peer-dashboard"/)
    assert.match(html, /id="peer-connected-list"/)
    assert.match(html, /id="peer-editing-list"/)
    assert.match(html, /id="peer-activity-list"/)
    assert.match(html, /window\.__p2pmdTogglePeerDashboard/)
    assert.match(html, /fetch\(roomUrl\('\/activity'\)\)/)
    assert.match(html, /fetch\(roomUrl\('\/presence'\)/)
    assert.match(html, /source\.addEventListener\('activity'/)
    assert.match(html, /const isSnapshot = Array\.isArray\(activity\)/)
    assert.match(html, /peerActivityLog = incoming/)
    assert.match(html, /MAX_PEER_ACTIVITY_ITEMS = 150/)
    assert.match(html, /MAX_PEER_DASHBOARD_ITEMS = 100/)
    assert.match(html, /if \(peerDashboardBackdrop\.hidden\) return/)
    assert.match(html, /\.slice\(0, MAX_PEER_ACTIVITY_ITEMS\)/)
    assert.match(html, /message\.textContent =/)
    assert.doesNotMatch(html, /peerActivityList\.innerHTML/)
  })

  it('sends editor presence with updates and persists peer profile changes natively', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /isTyping: localPeerIsTyping/)
    assert.match(html, /cursorLine: cursor\.line/)
    assert.match(html, /cursorColumn: cursor\.column/)
    assert.match(html, /markLocalPeerTyping\(\)/)
    assert.match(html, /requestNativeBridge\('peer-profile', \{ name: nextName \}\)/)
  })
})
