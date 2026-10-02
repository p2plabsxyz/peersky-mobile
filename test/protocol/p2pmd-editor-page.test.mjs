import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getP2pmdEditorPage } from '../../backend/p2pmd/server.mjs'
import { splitMarkdownSlides } from '../../backend/p2pmd/preview.mjs'
import yjsBrowserScript from '../../backend/p2pmd/yjs-runtime.mjs'

describe('p2pmd mobile editor page routing', () => {
  it('routes collaboration endpoints through the joined room base URL', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /fetch\(roomUrl\('\/doc'\)\)/)
    assert.match(html, /fetch\(roomUrl\('\/doc\/update'\)/)
    assert.match(html, /fetch\(roomUrl\('\/doc\/yjsstate'\)\)/)
    assert.match(html, /new EventSource\(roomUrl\('\/events\?'/)
    assert.match(html, /withInitialRoomRetry/)
    assert.match(html, /INITIAL_ROOM_RETRY_ATTEMPTS/)
  })

  // Whoever hosts the room used to choose the editor's yjs, and with it the
  // code that ran next to the app's bridge.
  it('runs only its own code, never a script from the room', () => {
    const html = getP2pmdEditorPage()

    assert.ok(html.includes(yjsBrowserScript.replace(/<\/script/gi, '<\\/script')))
    assert.doesNotMatch(html, /\/lib\/yjs\.min\.js/)
    assert.doesNotMatch(html, /script\.src\s*=/)
    assert.doesNotMatch(html, /<script[^>]+src=/i)
    assert.match(html, /<meta name="referrer" content="no-referrer">/)
  })

  it('publishes only with the nonce the app handed over', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /function publishToHyper\(nonce\)/)
    assert.match(html, /notifyNative\('p2pmd-publish-requested', \{\s+nonce,/)
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
    assert.match(html, /# Welcome to Your Presentation/)
    assert.match(html, /This will clear your notes and give you a slides template[.] Continue[?]/)
    assert.match(html, /replaceDocumentRange\(0, input[.]value[.]length, slidesTemplate, 0, 0\)/)
    assert.match(html, /else if \(format === 'slides'\) toggleSlides\(\)/)
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

  // The bar is hidden over the deck, so adding an image means going back to
  // the editor. That used to make Preview show one long page and Publish send
  // the deck as a note.
  it('keeps a deck a deck while it is being edited', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /aria-label="View as slides" aria-pressed="false"/)
    assert.match(html, /if \(viewMode === 'slides'\) presenting = true/)
    assert.match(html, /else setViewMode\(presenting \? 'slides' : 'preview'\)/)
    assert.match(html, /mode: presenting && hasSlideBreaks\(input\.value\) \? 'slides' : 'note'/)
    assert.match(html, /slides: presenting/)
    assert.match(html, /if \(presenting && viewMode === 'edit'\) \{\s+presenting = false/)
  })

  it('keeps the blank line above a slide break when an image goes in', () => {
    const html = getP2pmdEditorPage()
    const source = html.slice(
      html.indexOf('function createMarkdownBlock('),
      html.indexOf('function replaceUploadPlaceholder(')
    )
    // eslint-disable-next-line no-new-func
    const createMarkdownBlock = new Function('newline', `${source}; return createMarkdownBlock`)('\n')
    const deck = '# One\n\n---\n\n# Two'
    const blankLine = deck.indexOf('\n\n---') + 1
    const block = createMarkdownBlock(deck, blankLine, blankLine, '![cat](hyper://abc/cat.png)')
    const next = deck.slice(0, blankLine) + block.text + deck.slice(blankLine)

    assert.deepEqual(splitMarkdownSlides(next), ['# One\n![cat](hyper://abc/cat.png)', '# Two'])
  })

  it('provides synchronized LaTeX mode and scientific templates', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /data-format="latex"/)
    assert.match(html, /data-format="inline-math"/)
    assert.match(html, /data-format="block-math"/)
    // Both templates live behind one button in the document bar, and the menu
    // is built from the template list rather than written out here.
    assert.match(html, /data-menu="template"/)
    assert.match(html, /id="template-menu"/)
    assert.doesNotMatch(html, /id="latex-template-menu"/)
    assert.match(html, /Research Paper/)
    assert.match(html, /Technical Documentation/)
    assert.match(html, /ydoc\.getMap\('settings'\)/)
    assert.match(html, /LATEX_MODE_YJS_KEY = 'latexModeEnabled'/)
    assert.match(html, /roomRole === 'host'/)
    assert.match(html, /latexModeEnabled/)
    assert.match(html, /window\.P2pmdIeee/)
    assert.doesNotMatch(html, /roomUrl\('\/lib\/ieee\.min\.js'\)/)
    assert.match(html, /window\.P2pmdIeee\.render\(preview, result\.html\)/)
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

  it('keeps gutter rows aligned with editor lines', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /--editor-font-size: 16px/)
    assert.match(html, /--editor-line-height: 24[.]8px/)
    assert.match(html, /#line-gutter[\s\S]*font: var\(--editor-font-size\)\/var\(--editor-line-height\)/)
    assert.match(html, /[.]gutter-line[\s\S]*min-height: var\(--editor-line-height\)/)
    assert.match(html, /textarea[\s\S]*font: var\(--editor-font-size\)\/var\(--editor-line-height\)/)
    assert.match(html, /const oldText = ydoc && ytext [^\n]+ getYTextSnapshot\(\) : lastInputContent/)
    assert.match(html, /const change = diffTextChange\(oldText, newText\)/)
    assert.match(html, /const gutterUpdate = markEditedLines\(oldText, newText\)/)
    assert.match(html, /applyTextDiff\(ytext, oldText, newText, Y_ORIGIN_LOCAL_INPUT, change\)/)
    assert.match(html, /if \(gutterUpdate\) renderLineGutter\(gutterUpdate\)/)
    assert.match(html, /while \(lineGutter[.]childElementCount > count\)/)
    assert.match(html, /const startIndex = update [^\n]+ update[.]startLine - 1/)
    assert.doesNotMatch(html, /lineGutter[.]replaceChildren\(\)/)
    assert.doesNotMatch(html, /const previousLines = String\(previousContent/)
    assert.doesNotMatch(html, /const nextLines = String\(nextContent/)
    assert.match(html, /function countMatchingPrefixLines\(previousValue, nextValue\)/)
    assert.match(html, /function countMatchingSuffixLines\(previousValue, nextValue, availablePrevious, availableNext\)/)
  })

  it('timestamps mobile line ownership for desktop conflict resolution', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /const editedAttribution = \{ [.]{3}localAuthor, updatedAt: Date[.]now\(\) \}/)
    assert.match(html, /normalized[.]updatedAt = updatedAt/)
  })

  it('uses a cached CRDT snapshot and safe peer avatar fallback', () => {
    const html = getP2pmdEditorPage()

    assert.match(html, /function getYTextSnapshot\(\)/)
    assert.match(html, /ytextSnapshot[.]length === ytext[.]length/)
    assert.match(html, /ytextSnapshot = ytext[.]toString\(\)/)
    assert.match(html, /String\(peer[.]name \|\| ''\)[.]trim\(\)[.]charAt\(0\) \|\| '[?]'/)
  })
})
