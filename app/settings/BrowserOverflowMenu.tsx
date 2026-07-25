import type { ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import DisplayIcon from '../../assets/icons/bootstrap/display.svg'
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
  onOpenSettings,
  onOpenZoom,
  onReload,
  onSharePage,
  onShow,
  onToggleDesktopView,
  onToggleBookmark
}: BrowserOverflowMenuProps) {
  const iconColor = isDark ? BROWSER_PALETTES.dark.text : BROWSER_PALETTES.light.text

  return (
    <>
      <Pressable
        accessibilityLabel='Open browser menu'
        accessibilityRole='button'
        style={[styles.trigger, isDark ? darkStyles.trigger : null]}
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
          <View style={[
            styles.menu,
            position === 'bottom' ? { bottom: offset } : { top: offset },
            isDark ? darkStyles.menu : null
          ]}>
            {bookmarkActionAvailable && onToggleBookmark && onReload && (
              <View style={[styles.quickActions, isDark ? darkStyles.divider : null]}>
                <QuickAction
                  accessibilityLabel={isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
                  disabled={bookmarksDisabled}
                  icon={isBookmarked
                    ? <StarFillIcon width={QUICK_ACTION_ICON_SIZE} height={QUICK_ACTION_ICON_SIZE} color={iconColor} />
                    : <StarIcon width={QUICK_ACTION_ICON_SIZE} height={QUICK_ACTION_ICON_SIZE} color={iconColor} />}
                  isDark={isDark}
                  onPress={onToggleBookmark}
                  selected={isBookmarked}
                />
                <QuickAction
                  accessibilityLabel='Reload page'
                  icon={<ReloadIcon width={QUICK_ACTION_ICON_SIZE} height={QUICK_ACTION_ICON_SIZE} color={iconColor} />}
                  isDark={isDark}
                  onPress={onReload}
              />
            </View>
            )}
            {shareActionAvailable && onSharePage && (
              <>
                <MenuItem
                  icon={<ShareIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={iconColor} />}
                  isDark={isDark}
                  label='Share'
                  onPress={onSharePage}
                />
                {onOpenZoom && (
                  <MenuItem
                    icon={<ZoomIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={iconColor} />}
                    isDark={isDark}
                    label='Zoom'
                    onPress={onOpenZoom}
                  />
                )}
                {onToggleDesktopView && (
                  <MenuItem
                    icon={<DisplayIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={iconColor} />}
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
              icon={<PlusIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={iconColor} />}
              isDark={isDark}
              label='New Tab'
              onPress={onNewTab}
            />
            <MenuItem
              disabled={bookmarksDisabled}
              icon={<BookmarksIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={iconColor} />}
              isDark={isDark}
              label='Bookmarks'
              onPress={onOpenBookmarks}
            />
            <MenuItem
              icon={<GearIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={iconColor} />}
              isDark={isDark}
              label='Settings'
              onPress={onOpenSettings}
            />
          </View>
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
        <CheckIcon width={MENU_ICON_SIZE} height={MENU_ICON_SIZE} color={isDark ? BROWSER_PALETTES.dark.text : BROWSER_PALETTES.light.text} />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    backgroundColor: '#e8f0fb',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 34
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
  trigger: {
    backgroundColor: BROWSER_PALETTES.dark.button
  },
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
    backgroundColor: BROWSER_PALETTES.dark.text
  },
  pressed: {
    backgroundColor: BROWSER_PALETTES.dark.selectedBackground
  },
  quickAction: {
    backgroundColor: BROWSER_PALETTES.dark.button
  }
})
