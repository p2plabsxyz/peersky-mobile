import type { ComponentType } from 'react'
import { useRef } from 'react'
import type { SvgProps } from 'react-native-svg'
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { dimWhenPressed, ICON_RIPPLE, ROUND_PRESS } from './press-feedback'
import { BrowserOverflowMenu } from './settings/BrowserOverflowMenu'
import type { ToolbarButton } from './settings/useBrowserPreferences'
import { styles } from './styles'
import { TOOLBAR_BUTTON_ACTIVE_ICONS, TOOLBAR_BUTTON_ICONS } from './toolbar-button-icons'
import { burnsFromMenu } from './toolbar-button.mjs'
import BackIcon from '../assets/icons/bootstrap/arrow-left.svg'
import ForwardIcon from '../assets/icons/bootstrap/arrow-right.svg'
import BookmarksIcon from '../assets/icons/bootstrap/bookmarks.svg'
import DisplayIcon from '../assets/icons/bootstrap/display.svg'

// The same weight as the address bar's own icons, so the two bars read as
// one set of controls.
const NAV_ICON_SIZE = 22
const NAV_ICON_OPACITY = 0.76
const NAV_ICON_STROKE_WIDTH = 0.35

type BrowserNavBarProps = {
  bookmarkActionAvailable: boolean
  bookmarksDisabled: boolean
  favouritesDisabled: boolean
  isFavourited: boolean
  canGoBack: boolean
  canGoForward: boolean
  desktopView: boolean
  isBookmarked: boolean
  isDark: boolean
  isHome: boolean
  menuVisible: boolean
  printActionAvailable: boolean
  // A website or hyper:// page: one with an article to read, and one to send
  // to your other devices.
  readerActionAvailable: boolean
  newTabDisabled: boolean
  palette: {
    border: string
    mutedText: string
    seam: string
    shell: string
    surface: string
  }
  shareActionAvailable: boolean
  showTopBorder: boolean
  tabCount: number
  // What sits in the middle of the bar: the burn button unless another was
  // chosen in Settings > Appearance.
  toolbarButton: ToolbarButton
  onBack: () => void
  onBurnTabs: () => void
  onCloseMenu: () => void
  onForward: () => void
  onGoHome: () => void
  onNewTab: () => void
  onNewIncognitoTab: () => void
  onOpenBookmarks: () => void
  onOpenDownloads: () => void
  onOpenHistory: () => void
  onOpenMenu: () => void
  onOpenNearby: () => void
  onOpenSettings: () => void
  onOpenTabs: () => void
  onOpenZoom: () => void
  onPrintPage: () => void
  onReaderView: () => void
  onSendToDevices: () => void
  onSharePage: () => void
  onToggleBookmark: () => void
  onToggleDesktopView: () => void
  onToggleFavourite: () => void
}

/**
 * Back, forward, tabs and the menu, along the bottom.
 *
 * This is the half of the old toolbar that never needed to be next to the
 * address. Down here it is within reach of a thumb, it stays put when the
 * address bar moves, and the address bar gets the whole width to itself.
 */
export function BrowserNavBar ({
  bookmarkActionAvailable,
  bookmarksDisabled,
  favouritesDisabled,
  isFavourited,
  canGoBack,
  canGoForward,
  desktopView,
  isBookmarked,
  isDark,
  isHome,
  menuVisible,
  printActionAvailable,
  readerActionAvailable,
  newTabDisabled,
  palette,
  shareActionAvailable,
  showTopBorder,
  tabCount,
  toolbarButton,
  onBack,
  onBurnTabs,
  onCloseMenu,
  onForward,
  onGoHome,
  onNewTab,
  onNewIncognitoTab,
  onOpenBookmarks,
  onOpenDownloads,
  onOpenHistory,
  onOpenMenu,
  onOpenNearby,
  onOpenSettings,
  onOpenTabs,
  onOpenZoom,
  onPrintPage,
  onReaderView,
  onSendToDevices,
  onSharePage,
  onToggleBookmark,
  onToggleDesktopView,
  onToggleFavourite
}: BrowserNavBarProps) {
  const insets = useSafeAreaInsets()

  // iOS will not present the share sheet on top of a modal that is still
  // fading out, and it fails without a word, which is why sharing worked from
  // the address bar and did nothing from the menu. Wait for the menu to finish
  // leaving. Android has no such rule and no onDismiss, so it runs straight
  // away.
  const pendingMenuActionRef = useRef<(() => void) | null>(null)

  function afterMenuCloses (action: () => void) {
    if (Platform.OS === 'ios') pendingMenuActionRef.current = action
    onCloseMenu()
    if (Platform.OS !== 'ios') action()
  }

  function navigate (action: () => void) {
    Keyboard.dismiss()
    action()
  }

  // The middle button, whichever it is. Off, like back and forward, when it has
  // nothing to act on here: sharing an app screen, bookmarking the home page.
  const middle: Record<ToolbarButton, { label: string, disabled?: boolean, active?: boolean, onPress: () => void }> = {
    bookmark: {
      label: isBookmarked ? 'Remove bookmark' : 'Add bookmark',
      active: isBookmarked,
      disabled: !bookmarkActionAvailable || bookmarksDisabled,
      onPress: onToggleBookmark
    },
    favourite: {
      label: isFavourited ? 'Remove favourite' : 'Add favourite',
      active: isFavourited,
      disabled: !bookmarkActionAvailable || favouritesDisabled,
      onPress: onToggleFavourite
    },
    bookmarks: { label: 'Bookmarks', disabled: bookmarksDisabled, onPress: onOpenBookmarks },
    burn: { label: 'Burn tabs, history and cached data', onPress: onBurnTabs },
    downloads: { label: 'Downloads', onPress: onOpenDownloads },
    history: { label: 'History', onPress: onOpenHistory },
    home: { label: 'Home', disabled: isHome, onPress: onGoHome },
    incognito: { label: 'New incognito tab', disabled: newTabDisabled, onPress: onNewIncognitoTab },
    'new-tab': { label: 'New tab', disabled: newTabDisabled, onPress: onNewTab },
    settings: { label: 'Settings', onPress: onOpenSettings },
    share: { label: 'Share', disabled: !shareActionAvailable, onPress: onSharePage },
    zoom: { label: 'Zoom', disabled: !shareActionAvailable, onPress: onOpenZoom }
  }
  const middleAction = middle[toolbarButton] || middle.burn
  const middleIcon = (middleAction.active && TOOLBAR_BUTTON_ACTIVE_ICONS[toolbarButton]) ||
    TOOLBAR_BUTTON_ICONS[toolbarButton] ||
    TOOLBAR_BUTTON_ICONS.burn

  return (
    <View
      style={[
        styles.browserNavBar,
        {
          backgroundColor: isDark ? palette.surface : palette.shell,
          borderTopColor: palette.seam,
          // With the address bar directly above, its own top edge is the only
          // seam this chrome needs. A second line between the two bars cuts
          // them apart.
          borderTopWidth: showTopBorder ? StyleSheet.hairlineWidth : 0,
          paddingLeft: insets.left,
          paddingRight: insets.right
        }
      ]}
    >
      {/* On the home screen there is no history to move through, so the two
          slots go to what is actually worth reaching from there. */}
      {isHome
        ? (
          <>
            <NavButton
              icon={BookmarksIcon}
              label='Bookmarks'
              palette={palette}
              onPress={() => navigate(onOpenBookmarks)}
            />
            <NavButton
              icon={DisplayIcon}
              label='Nearby devices'
              palette={palette}
              onPress={() => navigate(onOpenNearby)}
            />
          </>
          )
        : (
          <>
            <NavButton
              disabled={!canGoBack}
              icon={BackIcon}
              label='Go back'
              palette={palette}
              onPress={() => navigate(onBack)}
            />
            <NavButton
              disabled={!canGoForward}
              icon={ForwardIcon}
              label='Go forward'
              palette={palette}
              onPress={() => navigate(onForward)}
            />
          </>
          )}

      {/* Close every tab and clear what browsing left behind, in one press,
          unless another button was chosen for this place. */}
      <NavButton
        disabled={middleAction.disabled}
        icon={middleIcon}
        label={middleAction.label}
        palette={palette}
        onPress={() => navigate(middleAction.onPress)}
      />

      <Pressable
        accessibilityLabel={`Open tabs, ${tabCount} open`}
        accessibilityRole='button'
        android_ripple={ICON_RIPPLE}
        style={({ pressed }) => [styles.browserNavBarButton, ROUND_PRESS, dimWhenPressed(pressed)]}
        onPress={() => navigate(onOpenTabs)}
      >
        <View style={[styles.browserTabCountIcon, { borderColor: palette.mutedText }]}>
          <Text style={[styles.browserTabCountText, { color: palette.mutedText }]}>{tabCount}</Text>
        </View>
      </Pressable>

      <BrowserOverflowMenu
        bookmarkActionAvailable={bookmarkActionAvailable}
        bookmarksDisabled={bookmarksDisabled}
        desktopView={desktopView}
        favouritesDisabled={favouritesDisabled}
        isBookmarked={isBookmarked}
        isFavourited={isFavourited}
        isDark={isDark}
        newTabDisabled={newTabDisabled}
        shareActionAvailable={shareActionAvailable}
        visible={menuVisible}
        onClose={onCloseMenu}
        onDismissed={() => {
          const action = pendingMenuActionRef.current
          pendingMenuActionRef.current = null
          action?.()
        }}
        // With another button in its place on the bar, burning moves here.
        {...(burnsFromMenu(toolbarButton) ? { onBurnTabs: () => afterMenuCloses(onBurnTabs) } : {})}
        onNewTab={onNewTab}
        onNewIncognitoTab={onNewIncognitoTab}
        onOpenBookmarks={onOpenBookmarks}
        onOpenDownloads={onOpenDownloads}
        onOpenHistory={onOpenHistory}
        onOpenSettings={onOpenSettings}
        onOpenZoom={() => {
          onCloseMenu()
          onOpenZoom()
        }}
        {...(printActionAvailable ? { onPrintPage: () => afterMenuCloses(onPrintPage) } : {})}
        {...(readerActionAvailable ? { onReaderView: () => afterMenuCloses(onReaderView) } : {})}
        {...(readerActionAvailable ? { onSendToDevices: () => afterMenuCloses(onSendToDevices) } : {})}
        onSharePage={() => afterMenuCloses(onSharePage)}
        onShow={() => {
          Keyboard.dismiss()
          onOpenMenu()
        }}
        onToggleBookmark={onToggleBookmark}
        onToggleFavourite={onToggleFavourite}
        onToggleDesktopView={() => {
          onCloseMenu()
          onToggleDesktopView()
        }}
      />
    </View>
  )
}

function NavButton ({
  disabled = false,
  icon: Icon,
  label,
  palette,
  onPress
}: {
  disabled?: boolean
  icon: ComponentType<SvgProps>
  label: string
  palette: { mutedText: string }
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      disabled={disabled}
      android_ripple={ICON_RIPPLE}
      style={({ pressed }) => [
        styles.browserNavBarButton,
        ROUND_PRESS,
        disabled ? styles.browserNavButtonDisabled : null,
        dimWhenPressed(pressed)
      ]}
      onPress={onPress}
    >
      <Icon
        width={NAV_ICON_SIZE}
        height={NAV_ICON_SIZE}
        color={palette.mutedText}
        opacity={NAV_ICON_OPACITY}
        stroke={palette.mutedText}
        strokeWidth={NAV_ICON_STROKE_WIDTH}
      />
    </Pressable>
  )
}
