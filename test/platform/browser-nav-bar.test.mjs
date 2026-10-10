import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

const navBar = await readFile(new URL('../../app/BrowserNavBar.tsx', import.meta.url), 'utf8')
const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')
const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

describe('browser chrome layout', () => {
  test('five slots: two that change, then burn, tabs and the menu', () => {
    assert.match(navBar, /label='Go back'/)
    assert.match(navBar, /label='Go forward'/)
    assert.match(navBar, /burn: \{ label: 'Burn tabs, history and cached data', onPress: onBurnTabs \}/)
    assert.match(navBar, /Open tabs, \$\{tabCount\} open/)
    assert.match(navBar, /<BrowserOverflowMenu[\s>]/)
  })

  // DuckDuckGo lets you swap its Fire Button for another; so can this bar.
  test('the middle button is whichever was chosen, and burning moves to the menu', () => {
    assert.match(navBar, /const middleAction = middle\[toolbarButton\] \|\| middle\.burn/)
    assert.match(navBar, /disabled=\{middleAction\.disabled\}\s+icon=\{middleIcon\}\s+label=\{middleAction\.label\}/)
    // Off where it has nothing to act on, like back and forward.
    assert.match(navBar, /share: \{ label: 'Share', disabled: !shareActionAvailable, onPress: onSharePage \}/)
    assert.match(navBar, /home: \{ label: 'Home', disabled: isHome, onPress: onGoHome \}/)
    assert.match(navBar, /\.\.\.\(burnsFromMenu\(toolbarButton\) \? \{ onBurnTabs: \(\) => afterMenuCloses\(onBurnTabs\) \} : \{\}\)/)
    assert.match(index, /toolbarButton=\{browserPreferences\.toolbarButton\}/)
  })

  test('the home screen has no history, so those two slots go elsewhere', () => {
    const home = navBar.slice(navBar.indexOf('{isHome'), navBar.indexOf('unless another button was chosen'))

    assert.match(home, /label='Bookmarks'/)
    assert.match(home, /label='Nearby devices'/)
    // And back and forward are still there for every other page.
    assert.match(home, /label='Go back'/)
  })

  test('no second line where the two bars meet', () => {
    // The address bar sits directly above when it is at the bottom, and its
    // own top edge is the seam.
    assert.match(navBar, /borderTopWidth: showTopBorder \? StyleSheet\.hairlineWidth : 0/)
    assert.match(index, /showTopBorder=\{browserPreferences\.addressBarPosition === 'top'\}/)
  })

  test('the address bar carries only the address and the page actions', () => {
    // The whole point of moving the rest off: the address gets the width, and
    // it can sit at either end without the controls following it around.
    assert.doesNotMatch(toolbar, /Go back|Go forward|Open tabs|BrowserOverflowMenu/)
    assert.match(toolbar, /accessibilityLabel='Browser address'/)
    assert.match(toolbar, /Reload page/)
    // One button after reload, Share unless another is chosen.
    assert.match(toolbar, /<AddressBarActionButton/)
    assert.match(index, /case 'share':\s+return browserShareActionAvailable\s+\? \{ id: 'share', label: 'Share page'/)
  })

  test('the address bar moves, the navigation bar does not', () => {
    assert.match(index, /addressBarPosition === 'top' && browserToolbar/)
    assert.match(index, /addressBarPosition === 'bottom' && browserToolbar/)
    // Rendered unconditionally, and after the bottom address bar, so it is the
    // last thing on screen either way.
    const bottomAt = index.indexOf("addressBarPosition === 'bottom' && browserToolbar")
    const navAt = index.indexOf('browserNavBar}', bottomAt)
    assert.ok(navAt > bottomAt, 'the navigation bar has to come after the address bar')
    // Rendered once, and not while the keyboard is up.
    assert.equal((index.match(/browserNavBar\}/g) || []).length, 1)
    assert.match(index, /\{!isKeyboardVisible && browserNavBar\}/)
  })

  test('top is what a new install gets', async () => {
    const { DEFAULT_BROWSER_PREFERENCES } = await import('../../app/settings/browser-preferences.mjs')

    assert.equal(DEFAULT_BROWSER_PREFERENCES.addressBarPosition, 'top')
  })
})

describe('chrome polish', () => {
  test('the seam never changes width, only colour', async () => {
    const { readFile } = await import('node:fs/promises')
    const toolbar = await readFile(new URL('../../app/BrowserToolbar.tsx', import.meta.url), 'utf8')

    // Taking the border away while the suggestion list is open moved
    // everything below it by a pixel, and on a photograph that jump is
    // visible every time you tap the address bar.
    assert.doesNotMatch(toolbar, /borderBottomWidth: isAddressFocused/)
    assert.doesNotMatch(toolbar, /borderTopWidth: isAddressFocused/)
    assert.match(toolbar, /const seamColor = isAddressFocused \? 'transparent' : palette\.seam/)
    assert.equal((toolbar.match(/StyleSheet\.hairlineWidth/g) || []).length, 2)
  })
})

describe('the bottom of the screen on Android', () => {
  test('no band of page colour stays under the navigation bar after the keyboard', async () => {
    const { readFile } = await import('node:fs/promises')
    const index = await readFile(new URL('../../app/index.tsx', import.meta.url), 'utf8')

    // Android reports a closed keyboard a little above the bottom of the
    // screen, and the padding for it stayed behind under the navigation bar.
    assert.match(index, /enabled=\{\s+\/\/[^\n]*\n(?:\s+\/\/[^\n]*\n)*\s+\(Platform\.OS === 'ios' \|\| isKeyboardVisible\) &&/)
  })
})

describe('peerchat onboarding', () => {
  test('the continue button keeps its gap when the keyboard opens', async () => {
    const { readFile } = await import('node:fs/promises')
    const screen = await readFile(
      new URL('../../app/peerchat/PeerChatScreen.tsx', import.meta.url),
      'utf8'
    )

    // KeyboardAvoidingView with behavior='padding' sets the container's own
    // paddingBottom to the keyboard height, throwing away whatever was there,
    // so the gap has to live on the button.
    assert.match(screen, /introScreen: \{ flex: 1 \}/)
    assert.match(screen, /onboardingScreen: \{ flex: 1 \}/)
    assert.match(screen, /introContinue: \{[\s\S]{0,400}marginBottom: 28/)
  })
})

// Searches need a space bar, which iOS's URL keyboard leaves off its letters.
test('the address bar types searches as easily as addresses', () => {
  assert.match(toolbar, /keyboardType=\{Platform\.OS === 'ios' \? 'web-search' : 'url'\}/)
})
