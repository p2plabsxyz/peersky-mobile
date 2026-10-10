import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import DisplayIcon from '../../assets/icons/bootstrap/display.svg'
import DownloadIcon from '../../assets/icons/bootstrap/download.svg'
import FileTextIcon from '../../assets/icons/bootstrap/file-text.svg'
import FireIcon from '../../assets/icons/bootstrap/fire.svg'
import HistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import IncognitoIcon from '../../assets/icons/bootstrap/incognito.svg'
import PhoneIcon from '../../assets/icons/bootstrap/phone.svg'
import BookmarksIcon from '../../assets/icons/bootstrap/bookmarks.svg'
import GearIcon from '../../assets/icons/bootstrap/gear.svg'
import PlusIcon from '../../assets/icons/bootstrap/plus-lg.svg'
import PrinterIcon from '../../assets/icons/bootstrap/printer.svg'
import ShareIcon from '../../assets/icons/bootstrap/share.svg'
import BookmarkFillIcon from '../../assets/icons/bootstrap/bookmark-fill.svg'
import BookmarkIcon from '../../assets/icons/bootstrap/bookmark.svg'
import StarFillIcon from '../../assets/icons/bootstrap/star-fill.svg'
import StarIcon from '../../assets/icons/bootstrap/star.svg'
import ZoomIcon from '../../assets/icons/bootstrap/zoom-in.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import { MODAL_ORIENTATIONS } from '../modal-orientations'

const MENU_ICON_SIZE = 22
const CARD_ICON_SIZE = 26
const MENU_ICON_STROKE_WIDTH = 0.35
// The sheet rises from fully below the screen and settles slowly at the end,
// the way a system sheet does. It used to start half way up and arrive almost
// at once, which read as the menu snapping open.
const OPEN_MS = 380
const CLOSE_MS = 220
const OPEN_EASING = Easing.bezier(0.2, 0.8, 0.2, 1)
const CLOSE_EASING = Easing.bezier(0.4, 0, 1, 1)

type BrowserOverflowMenuProps = {
  bookmarkActionAvailable?: boolean
  bookmarksDisabled?: boolean
  favouritesDisabled?: boolean
  isFavourited?: boolean
  desktopView?: boolean
  isBookmarked?: boolean
  isDark?: boolean
  newTabDisabled?: boolean
  shareActionAvailable?: boolean
  visible: boolean
  // Only when the burn button is not on the bar.
  onBurnTabs?: () => void
  onClose: () => void
  onDismissed?: () => void
  onNewTab: () => void
  onNewIncognitoTab?: () => void
  onOpenBookmarks: () => void
  onOpenDownloads: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenZoom?: () => void
  onPrintPage?: () => void
  onReaderView?: () => void
  onSendToDevices?: () => void
  onToggleFavourite?: () => void
  onSharePage?: () => void
  onShow: () => void
  onToggleDesktopView?: () => void
  onToggleBookmark?: () => void
}

export function BrowserOverflowMenu ({
  bookmarkActionAvailable = false,
  bookmarksDisabled = false,
  favouritesDisabled = false,
  isFavourited = false,
  desktopView = false,
  isBookmarked = false,
  isDark = false,
  newTabDisabled = false,
  shareActionAvailable = false,
  visible,
  onBurnTabs,
  onClose,
  onDismissed,
  onNewTab,
  onNewIncognitoTab,
  onOpenBookmarks,
  onOpenDownloads,
  onOpenHistory,
  onOpenSettings,
  onOpenZoom,
  onPrintPage,
  onReaderView,
  onSendToDevices,
  onToggleFavourite,
  onSharePage,
  onShow,
  onToggleDesktopView,
  onToggleBookmark
}: BrowserOverflowMenuProps) {
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light
  const iconColor = isDark ? '#ffffff' : BROWSER_PALETTES.light.text
  const menuMaxHeight = Math.max(240, windowHeight * 0.76)

  // Modal's own slide animation carries the dimmed backdrop up with the sheet,
  // which reads as a shutter closing over the page rather than a sheet rising
  // in front of it. The backdrop fades and the sheet slides, separately.
  const open = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.timing(open, {
      duration: visible ? OPEN_MS : CLOSE_MS,
      easing: visible ? OPEN_EASING : CLOSE_EASING,
      toValue: visible ? 1 : 0,
      useNativeDriver: true
    })
    animation.start()

    return () => animation.stop()
  }, [open, visible])

  const iconProps = {
    color: iconColor,
    height: MENU_ICON_SIZE,
    stroke: iconColor,
    strokeWidth: MENU_ICON_STROKE_WIDTH,
    width: MENU_ICON_SIZE
  }
  const cardIconProps = { ...iconProps, height: CARD_ICON_SIZE, width: CARD_ICON_SIZE }
  const surface = isDark ? '#1c1c1e' : '#ffffff'
  const cardColor = isDark ? '#2c2c2e' : '#f1f3f7'

  const pageActions: ReactNode[] = []
  if (bookmarkActionAvailable && onToggleBookmark) {
    pageActions.push(
      <MenuItem
        key='bookmark'
        cardColor={cardColor}
        disabled={bookmarksDisabled}
        icon={isBookmarked ? <BookmarkFillIcon {...iconProps} /> : <BookmarkIcon {...iconProps} />}
        isDark={isDark}
        label={isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}
        onPress={onToggleBookmark}
      />
    )
  }
  if (bookmarkActionAvailable && onToggleFavourite) {
    pageActions.push(
      <MenuItem
        key='favourite'
        cardColor={cardColor}
        disabled={favouritesDisabled}
        icon={isFavourited ? <StarFillIcon {...iconProps} /> : <StarIcon {...iconProps} />}
        isDark={isDark}
        label={isFavourited ? 'Remove Favourite' : 'Add Favourite'}
        onPress={onToggleFavourite}
      />
    )
  }
  if (shareActionAvailable && onSharePage) {
    pageActions.push(
      <MenuItem
        key='share'
        cardColor={cardColor}
        icon={<ShareIcon {...iconProps} />}
        isDark={isDark}
        label='Share'
        onPress={onSharePage}
      />
    )
    if (onSendToDevices) {
      pageActions.push(
        <MenuItem
          key='send-to-devices'
          cardColor={cardColor}
          icon={<PhoneIcon {...iconProps} />}
          isDark={isDark}
          label='Send to Your Devices'
          onPress={onSendToDevices}
        />
      )
    }
    if (onReaderView) {
      pageActions.push(
        <MenuItem
          key='reader'
          cardColor={cardColor}
          icon={<FileTextIcon {...iconProps} />}
          isDark={isDark}
          label='Reader View'
          onPress={onReaderView}
        />
      )
    }
    if (onOpenZoom) {
      pageActions.push(
        <MenuItem
          key='zoom'
          cardColor={cardColor}
          icon={<ZoomIcon {...iconProps} />}
          isDark={isDark}
          label='Zoom'
          onPress={onOpenZoom}
        />
      )
    }
    if (onPrintPage) {
      pageActions.push(
        <MenuItem
          key='print'
          cardColor={cardColor}
          icon={<PrinterIcon {...iconProps} />}
          isDark={isDark}
          label='Print'
          onPress={onPrintPage}
        />
      )
    }
    if (onToggleDesktopView) {
      pageActions.push(
        <MenuItem
          key='desktop'
          cardColor={cardColor}
          icon={<DisplayIcon {...iconProps} />}
          isDark={isDark}
          label='Desktop View'
          onPress={onToggleDesktopView}
          selected={desktopView}
        />
      )
    }
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
        supportedOrientations={MODAL_ORIENTATIONS}
        animationType='none'
        transparent={true}
        visible={visible}
        onDismiss={onDismissed}
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.overlay} edges={['top', 'left', 'right']}>
          <Animated.View style={[styles.backdrop, { opacity: open }]}>
            <Pressable
              accessibilityLabel='Close browser menu'
              style={StyleSheet.absoluteFill}
              onPress={onClose}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: surface,
                paddingBottom: Math.max(insets.bottom, 12),
                transform: [{
                  translateY: open.interpolate({
                    inputRange: [0, 1],
                    outputRange: [windowHeight, 0]
                  })
                }]
              }
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: palette.border }]} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: menuMaxHeight }}
              contentContainerStyle={styles.content}
            >
              {/* The two people reach for, side by side and big enough to hit
                  without looking. Everything else is a list. */}
              <View style={styles.cardRow}>
                <BigAction
                  cardColor={cardColor}
                  disabled={newTabDisabled}
                  icon={<PlusIcon {...cardIconProps} />}
                  isDark={isDark}
                  label='New Tab'
                  onPress={onNewTab}
                />
                <BigAction
                  cardColor={cardColor}
                  icon={<GearIcon {...cardIconProps} />}
                  isDark={isDark}
                  label='Settings'
                  onPress={onOpenSettings}
                />
              </View>

              {pageActions.length > 0 && (
                <View style={[styles.group, { backgroundColor: cardColor }]}>
                  {withDividers(pageActions, palette.border)}
                </View>
              )}

              <View style={[styles.group, { backgroundColor: cardColor }]}>
                {withDividers([
                  ...(onNewIncognitoTab
                    ? [
                      <MenuItem
                        key='incognito'
                        cardColor={cardColor}
                        disabled={newTabDisabled}
                        icon={<IncognitoIcon {...iconProps} />}
                        isDark={isDark}
                        label='New Incognito Tab'
                        onPress={onNewIncognitoTab}
                      />
                      ]
                    : []),
                  <MenuItem
                    key='bookmarks'
                    cardColor={cardColor}
                    disabled={bookmarksDisabled}
                    icon={<BookmarksIcon {...iconProps} />}
                    isDark={isDark}
                    label='Bookmarks'
                    onPress={onOpenBookmarks}
                  />,
                  <MenuItem
                    key='history'
                    cardColor={cardColor}
                    icon={<HistoryIcon {...iconProps} />}
                    isDark={isDark}
                    label='History'
                    onPress={onOpenHistory}
                  />,
                  <MenuItem
                    key='downloads'
                    cardColor={cardColor}
                    icon={<DownloadIcon {...iconProps} />}
                    isDark={isDark}
                    label='Downloads'
                    onPress={onOpenDownloads}
                  />,
                  ...(onBurnTabs
                    ? [
                      <MenuItem
                        key='burn'
                        cardColor={cardColor}
                        icon={<FireIcon {...iconProps} />}
                        isDark={isDark}
                        label='Burn Tabs and Data'
                        onPress={onBurnTabs}
                      />
                      ]
                    : [])
                ], palette.border)}
              </View>
            </ScrollView>
          </Animated.View>
        </SafeAreaView>
      </Modal>
    </>
  )
}

// Hairlines between rows, inset past the icon so the list reads as one card.
function withDividers (items: ReactNode[], color: string) {
  return items.flatMap((item, index) => index === 0
    ? [item]
    : [<View key={`divider-${index}`} style={[styles.divider, { backgroundColor: color }]} />, item])
}

function BigAction ({
  cardColor,
  disabled = false,
  icon,
  isDark,
  label,
  onPress
}: {
  cardColor: string
  disabled?: boolean
  icon: ReactNode
  isDark: boolean
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.bigAction,
        { backgroundColor: cardColor },
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null
      ]}
      onPress={onPress}
    >
      {icon}
      <Text style={[styles.bigActionText, isDark ? darkStyles.text : null]}>{label}</Text>
    </Pressable>
  )
}

function MenuItem ({
  cardColor,
  disabled = false,
  icon,
  isDark,
  label,
  onPress,
  selected = false
}: {
  cardColor: string
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
        { backgroundColor: cardColor },
        disabled ? styles.disabled : null,
        pressed ? styles.pressed : null
      ]}
      onPress={onPress}
    >
      <View style={styles.menuItemIcon}>{icon}</View>
      <Text style={[styles.menuItemText, isDark ? darkStyles.text : null]}>{label}</Text>
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
  dots: { gap: 3 },
  dot: {
    backgroundColor: '#1f2a44',
    borderRadius: 2,
    height: 4,
    width: 4
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)'
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    elevation: 12,
    overflow: 'hidden',
    paddingTop: 8,
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 12
  },
  grabber: {
    alignSelf: 'center',
    borderRadius: 3,
    height: 5,
    marginBottom: 10,
    width: 40
  },
  content: {
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 4
  },
  cardRow: { flexDirection: 'row', gap: 12 },
  bigAction: {
    alignItems: 'center',
    borderRadius: 16,
    flex: 1,
    gap: 10,
    justifyContent: 'center',
    paddingVertical: 20
  },
  bigActionText: {
    color: BROWSER_PALETTES.light.text,
    fontSize: 15,
    fontWeight: '600'
  },
  group: {
    borderRadius: 16,
    overflow: 'hidden'
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56
  },
  menuItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 54,
    paddingHorizontal: 16
  },
  menuItemIcon: {
    alignItems: 'center',
    height: MENU_ICON_SIZE,
    justifyContent: 'center',
    width: MENU_ICON_SIZE
  },
  menuItemText: {
    color: BROWSER_PALETTES.light.text,
    flex: 1,
    fontSize: 16
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 }
})

const darkStyles = StyleSheet.create({
  text: { color: '#ffffff' },
  dot: { backgroundColor: BROWSER_PALETTES.dark.mutedText }
})
