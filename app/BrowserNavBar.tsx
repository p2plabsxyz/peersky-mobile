import type { ComponentType } from 'react'
import { useRef } from 'react'
import type { SvgProps } from 'react-native-svg'
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { BrowserOverflowMenu } from './settings/BrowserOverflowMenu'
import { styles } from './styles'
import BackIcon from '../assets/icons/bootstrap/arrow-left.svg'
import ForwardIcon from '../assets/icons/bootstrap/arrow-right.svg'
import BookmarksIcon from '../assets/icons/bootstrap/bookmarks.svg'
import DisplayIcon from '../assets/icons/bootstrap/display.svg'
import FireIcon from '../assets/icons/bootstrap/fire.svg'

// The same weight as the address bar's own icons, so the two bars read as
// one set of controls.
const NAV_ICON_SIZE = 22
const NAV_ICON_OPACITY = 0.76
const NAV_ICON_STROKE_WIDTH = 0.35

type BrowserNavBarProps = {
  bookmarkActionAvailable: boolean
  bookmarksDisabled: boolean
  canGoBack: boolean
  canGoForward: boolean
  desktopView: boolean
  isBookmarked: boolean
  isDark: boolean
  isHome: boolean
  menuVisible: boolean
  printActionAvailable: boolean
  newTabDisabled: boolean
  palette: {
    border: string
    mutedText: string
    shell: string
    surface: string
  }
  shareActionAvailable: boolean
  showTopBorder: boolean
  tabCount: number
  onBack: () => void
  onBurnTabs: () => void
  onCloseMenu: () => void
  onForward: () => void
  onNewTab: () => void
  onOpenBookmarks: () => void
  onOpenDownloads: () => void
  onOpenHistory: () => void
  onOpenMenu: () => void
  onOpenNearby: () => void
  onOpenSettings: () => void
  onOpenTabs: () => void
  onOpenZoom: () => void
  onPrintPage: () => void
  onSharePage: () => void
  onToggleBookmark: () => void
  onToggleDesktopView: () => void
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
  canGoBack,
  canGoForward,
  desktopView,
  isBookmarked,
  isDark,
  isHome,
  menuVisible,
  printActionAvailable,
  newTabDisabled,
  palette,
  shareActionAvailable,
  showTopBorder,
  tabCount,
  onBack,
  onBurnTabs,
  onCloseMenu,
  onForward,
  onNewTab,
  onOpenBookmarks,
  onOpenDownloads,
  onOpenHistory,
  onOpenMenu,
  onOpenNearby,
  onOpenSettings,
  onOpenTabs,
  onOpenZoom,
  onPrintPage,
  onSharePage,
  onToggleBookmark,
  onToggleDesktopView
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

  return (
    <View
      style={[
        styles.browserNavBar,
        {
          backgroundColor: isDark ? palette.surface : palette.shell,
          borderTopColor: palette.border,
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

      {/* Close every tab and clear what browsing left behind, in one press. */}
      <NavButton
        icon={FireIcon}
        label='Burn tabs and cached data'
        palette={palette}
        onPress={() => navigate(onBurnTabs)}
      />

      <Pressable
        accessibilityLabel={`Open tabs, ${tabCount} open`}
        accessibilityRole='button'
        style={styles.browserNavBarButton}
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
        isBookmarked={isBookmarked}
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
        onNewTab={onNewTab}
        onOpenBookmarks={onOpenBookmarks}
        onOpenDownloads={onOpenDownloads}
        onOpenHistory={onOpenHistory}
        onOpenSettings={onOpenSettings}
        onOpenZoom={() => {
          onCloseMenu()
          onOpenZoom()
        }}
        {...(printActionAvailable ? { onPrintPage: () => afterMenuCloses(onPrintPage) } : {})}
        onSharePage={() => afterMenuCloses(onSharePage)}
        onShow={() => {
          Keyboard.dismiss()
          onOpenMenu()
        }}
        onToggleBookmark={onToggleBookmark}
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
      style={[styles.browserNavBarButton, disabled ? styles.browserNavButtonDisabled : null]}
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
