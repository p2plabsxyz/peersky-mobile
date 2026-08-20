import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import DisplayIcon from '../../assets/icons/bootstrap/display.svg'
import DownloadIcon from '../../assets/icons/bootstrap/download.svg'
import HistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import ReloadIcon from '../../assets/icons/bootstrap/arrow-clockwise.svg'
import BookmarksIcon from '../../assets/icons/bootstrap/bookmarks.svg'
import GearIcon from '../../assets/icons/bootstrap/gear.svg'
import PlusIcon from '../../assets/icons/bootstrap/plus-lg.svg'
import ShareIcon from '../../assets/icons/bootstrap/share.svg'
import StarFillIcon from '../../assets/icons/bootstrap/star-fill.svg'
import StarIcon from '../../assets/icons/bootstrap/star.svg'
import ZoomIcon from '../../assets/icons/bootstrap/zoom-in.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'

const MENU_ICON_SIZE = 18
const QUICK_ACTION_ICON_SIZE = 22
const MENU_ICON_STROKE_WIDTH = 0.35

type BrowserOverflowMenuProps = {
  bookmarkActionAvailable?: boolean
  bookmarksDisabled?: boolean
  desktopView?: boolean
  isBookmarked?: boolean
  isDark?: boolean
  newTabDisabled?: boolean
  offset?: number
  position?: 'top' | 'bottom'
  shareActionAvailable?: boolean
  visible: boolean
  onClose: () => void
  onNewTab: () => void
  onOpenBookmarks: () => void
  onOpenDownloads: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenZoom?: () => void
  onReload?: () => void
  onSharePage?: () => void
  onShow: () => void
  onToggleDesktopView?: () => void
  onToggleBookmark?: () => void
}

export function BrowserOverflowMenu ({
  bookmarkActionAvailable = false,
  bookmarksDisabled = false,
  desktopView = false,
  isBookmarked = false,
  isDark = false,
  newTabDisabled = false,
  offset = 70,
  position = 'top',
  shareActionAvailable = false,
  visible,
  onClose,
  onNewTab,
  onOpenBookmarks,
  onOpenDownloads,
  onOpenHistory,
  onOpenSettings,
  onOpenZoom,
  onReload,
  onSharePage,
  onShow,
  onToggleDesktopView,
  onToggleBookmark
}: BrowserOverflowMenuProps) {
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const iconColor = isDark ? BROWSER_PALETTES.dark.mutedText : BROWSER_PALETTES.light.text
  const menuEdge = 12 + insets.right
  const menuPosition = position === 'bottom'
    ? { bottom: offset + insets.bottom }
    : { top: offset + insets.top }
  const menuMaxHeight = Math.max(
    180,
    windowHeight - offset - insets.top - insets.bottom - 20
  )
  const menuIconProps = {
    color: iconColor,
    height: MENU_ICON_SIZE,
    stroke: iconColor,
    strokeWidth: MENU_ICON_STROKE_WIDTH,
    width: MENU_ICON_SIZE
  }
  const quickActionIconProps = {
    color: iconColor,
    height: QUICK_ACTION_ICON_SIZE,
    stroke: iconColor,
    strokeWidth: MENU_ICON_STROKE_WIDTH,
    width: QUICK_ACTION_ICON_SIZE
  }

  return (
    <>
      <Pressable
        accessibilityLabel='Open browser menu'
        accessibilityRole='button'
        style={styles.trigger}
        onPress={onShow}
      >
        <View style={styles.dots}>
          <View style={[styles.dot, isDark ? darkStyles.dot : null]} />
          <View style={[styles.dot, isDark ? darkStyles.dot : null]} />
          <View style={[styles.dot, isDark ? darkStyles.dot : null]} />
        </View>
      </Pressable>

      <Modal
        animationType='fade'
        transparent={true}
        visible={visible}
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right', 'bottom']}>
          <Pressable accessibilityLabel='Close browser menu' style={styles.backdrop} onPress={onClose} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={[
            styles.menu,
            menuPosition,
            { maxHeight: menuMaxHeight, right: menuEdge },
            isDark ? darkStyles.menu : null
          ]}
          >
            {bookmarkActionAvailable && onToggleBookmark && onReload && (
              <View style={[styles.quickActions, isDark ? darkStyles.divider : null]}>
                <QuickAction
                  accessibilityLabel={isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
                  disabled={bookmarksDisabled}
                  icon={isBookmarked
                    ? <StarFillIcon {...quickActionIconProps} />
                    : <StarIcon {...quickActionIconProps} />}
                  isDark={isDark}
                  onPress={onToggleBookmark}
                  selected={isBookmarked}
                />
                <QuickAction
                  accessibilityLabel='Reload page'
                  icon={<ReloadIcon {...quickActionIconProps} />}
                  isDark={isDark}
                  onPress={onReload}
              />
            </View>
            )}
            {shareActionAvailable && onSharePage && (
              <>
                <MenuItem
                  icon={<ShareIcon {...menuIconProps} />}
                  isDark={isDark}
                  label='Share'
                  onPress={onSharePage}
                />
                {onOpenZoom && (
                  <MenuItem
                    icon={<ZoomIcon {...menuIconProps} />}
                    isDark={isDark}
                    label='Zoom'
                    onPress={onOpenZoom}
                  />
                )}
                {onToggleDesktopView && (
                  <MenuItem
                    icon={<DisplayIcon {...menuIconProps} />}
                    isDark={isDark}
                    label='Desktop View'
                    onPress={onToggleDesktopView}
                    selected={desktopView}
                  />
                )}
              </>
            )}
            <MenuItem
              disabled={newTabDisabled}
              icon={<PlusIcon {...menuIconProps} />}
              isDark={isDark}
              label='New Tab'
              onPress={onNewTab}
            />
            <MenuItem
              disabled={bookmarksDisabled}
              icon={<BookmarksIcon {...menuIconProps} />}
              isDark={isDark}
              label='Bookmarks'
              onPress={onOpenBookmarks}
            />
            <MenuItem
              icon={<HistoryIcon {...menuIconProps} />}
              isDark={isDark}
              label='History'
              onPress={onOpenHistory}
            />
            <MenuItem
              icon={<DownloadIcon {...menuIconProps} />}
              isDark={isDark}
              label='Downloads'
              onPress={onOpenDownloads}
            />
            <MenuItem
              icon={<GearIcon {...menuIconProps} />}
              isDark={isDark}
              label='Settings'
              onPress={onOpenSettings}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

function QuickAction ({
  accessibilityLabel,
  disabled = false,
  icon,
  isDark,
  onPress,
  selected
}: {
  accessibilityLabel: string
  disabled?: boolean
  icon: ReactNode
  isDark: boolean
  onPress: () => void
  selected?: boolean
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole='button'
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.quickAction,
        isDark ? darkStyles.quickAction : null,
        disabled ? styles.menuItemDisabled : null,
        pressed ? styles.pressed : null,
        pressed && isDark ? darkStyles.pressed : null
      ]}
      onPress={onPress}
    >
      {icon}
    </Pressable>
  )
}

function MenuItem ({
  disabled = false,
  icon,
  isDark,
  label,
  onPress,
  selected = false
}: {
  disabled?: boolean
  icon: ReactNode
  isDark: boolean
  label: string
  onPress: () => void
  selected?: boolean
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.menuItem,
        disabled ? styles.menuItemDisabled : null,
        pressed ? styles.pressed : null,
        pressed && isDark ? darkStyles.pressed : null
      ]}
      onPress={onPress}
    >
      <View style={styles.menuItemIcon}>{icon}</View>
      <Text style={[styles.menuItemText, isDark ? darkStyles.menuItemText : null]}>{label}</Text>
      {selected && (
        <CheckIcon
          width={MENU_ICON_SIZE}
          height={MENU_ICON_SIZE}
          color={isDark ? BROWSER_PALETTES.dark.selectedControl : BROWSER_PALETTES.light.text}
          stroke={isDark ? BROWSER_PALETTES.dark.selectedControl : BROWSER_PALETTES.light.text}
          strokeWidth={MENU_ICON_STROKE_WIDTH}
        />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  dots: {
    gap: 3
  },
  dot: {
    backgroundColor: '#1f2a44',
    borderRadius: 2,
    height: 4,
    width: 4
  },
  overlay: {
    flex: 1
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(21, 24, 33, 0.16)'
  },
  menu: {
    position: 'absolute',
    right: 12,
    alignSelf: 'flex-end',
    backgroundColor: '#ffffff',
    borderColor: '#dbe3ef',
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
    minWidth: 220,
    overflow: 'hidden',
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10
  },
  quickActions: {
    borderBottomColor: '#e7ebf1',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  quickAction: {
    alignItems: 'center',
    backgroundColor: '#edf3fb',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  menuItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-start',
    minHeight: 52,
    paddingHorizontal: 18
  },
  menuItemDisabled: {
    opacity: 0.45
  },
  menuItemIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 22
  },
  pressed: {
    backgroundColor: '#edf5ff'
  },
  menuItemText: {
    color: '#1f2a44',
    flex: 1,
    fontSize: 15,
    fontWeight: '600'
  }
})

const darkStyles = StyleSheet.create({
  menu: {
    backgroundColor: BROWSER_PALETTES.dark.surface,
    borderColor: BROWSER_PALETTES.dark.border
  },
  menuItemText: {
    color: BROWSER_PALETTES.dark.text
  },
  divider: {
    borderBottomColor: BROWSER_PALETTES.dark.border
  },
  dot: {
    backgroundColor: BROWSER_PALETTES.dark.mutedText
  },
  pressed: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  quickAction: {
    backgroundColor: BROWSER_PALETTES.dark.button
  }
})
