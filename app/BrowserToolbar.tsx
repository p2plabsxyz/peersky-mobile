import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Platform,
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native'
import { getBrowserAddressForUrl, MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'
import { formatBrowserAddress } from './browser-appearance.mjs'
import { getSiteSecurity, SITE_SECURITY } from './site-security.mjs'
import ShieldLockIcon from '../assets/icons/bootstrap/shield-lock.svg'
import ShieldSlashIcon from '../assets/icons/bootstrap/shield-slash.svg'
import { BrowserOverflowMenu } from './settings/BrowserOverflowMenu'
import { HistorySuggestions } from './history/HistorySuggestions'
import type { BrowserHistoryItem } from './history/useBrowserHistory'
import { styles } from './styles'
import ReloadIcon from '../assets/icons/bootstrap/arrow-clockwise.svg'
import BackIcon from '../assets/icons/bootstrap/arrow-left.svg'
import ForwardIcon from '../assets/icons/bootstrap/arrow-right.svg'
import ShareIcon from '../assets/icons/bootstrap/arrow-bar-up.svg'
import ClearIcon from '../assets/icons/bootstrap/x-circle.svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const TOOLBAR_ICON_SIZE = 22
const ADDRESS_ACTION_ICON_SIZE = 20
// The shield is a solid glyph filling its box, while reload and share are
// thin outlines. Drawn at the same number it reads as the larger of the
// three, so it is drawn smaller to look the same size.
const ADDRESS_SECURITY_ICON_SIZE = 18
const ADDRESS_CLEAR_ICON_SIZE = 20
const TOOLBAR_ICON_STROKE_WIDTH = 0.35

type BrowserToolbarProps = {
  activeTabId: string
  address: string
  bookmarkActionAvailable: boolean
  bookmarksDisabled: boolean
  canGoBack: boolean
  canGoForward: boolean
  desktopView: boolean
  isBookmarked: boolean
  isDark: boolean
  isLoading: boolean
  historySuggestions: BrowserHistoryItem[]
  menuVisible: boolean
  navigationKey: string
  newTabDisabled: boolean
  palette: {
    accent: string
    address: string
    border: string
    button: string
    mutedText: string
    shell: string
    surface: string
    text: string
  }
  position: 'top' | 'bottom'
  currentUrl: string
  onOpenSiteInfo: () => void
  showFullAddress: boolean
  pageActionAvailable: boolean
  shareActionAvailable: boolean
  tabCount: number
  onAddressChange: (address: string) => void
  onBack: () => void
  onCloseMenu: () => void
  onForward: () => void
  onOpenMenu: () => void
  onNewTab: () => void
  onOpenBookmarks: () => void
  onOpenDownloads: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
  onOpenTabs: () => void
  onOpenZoom: () => void
  onReload: () => void
  onSharePage: () => void
  onSubmit: () => void
  onSuggestionPress: (url: string) => void
  onToggleDesktopView: () => void
  onToggleBookmark: () => void
}

// Matches browserToolbar's own paddingHorizontal.
const TOOLBAR_SIDE_PADDING = 8

export function BrowserToolbar ({
  activeTabId,
  address,
  bookmarkActionAvailable,
  bookmarksDisabled,
  canGoBack,
  canGoForward,
  desktopView,
  isBookmarked,
  isDark,
  isLoading,
  historySuggestions,
  menuVisible,
  navigationKey,
  newTabDisabled,
  palette,
  position,
  currentUrl,
  onOpenSiteInfo,
  showFullAddress,
  pageActionAvailable,
  shareActionAvailable,
  tabCount,
  onAddressChange,
  onBack,
  onCloseMenu,
  onForward,
  onOpenMenu,
  onNewTab,
  onOpenBookmarks,
  onOpenDownloads,
  onOpenHistory,
  onOpenSettings,
  onOpenTabs,
  onOpenZoom,
  onReload,
  onSharePage,
  onSubmit,
  onSuggestionPress,
  onToggleDesktopView,
  onToggleBookmark
}: BrowserToolbarProps) {
  const [isAddressFocused, setIsAddressFocused] = useState(false)
  // The page that loaded, not the text in the box: once you type an address
  // and tap away without going there, the two disagree.
  const siteSecurity = getSiteSecurity(getBrowserAddressForUrl(currentUrl))
  const showSiteSecurity = !isAddressFocused && siteSecurity !== SITE_SECURITY.UNKNOWN
  const [menuOffset, setMenuOffset] = useState(70)
  const addressInputRef = useRef<TextInput>(null)
  const addressFocusProgress = useRef(new Animated.Value(0)).current
  const toolbarControlsWidth = 80
  const addressActionIconColor = palette.mutedText

  useEffect(() => {
    const animation = Animated.timing(addressFocusProgress, {
      duration: 180,
      toValue: isAddressFocused ? 1 : 0,
      useNativeDriver: false
    })
    animation.start()

    return () => animation.stop()
  }, [addressFocusProgress, isAddressFocused])

  useEffect(() => {
    addressInputRef.current?.blur()
    Keyboard.dismiss()
    setIsAddressFocused(false)
  }, [activeTabId, navigationKey])

  function finishAddressEditing () {
    addressInputRef.current?.blur()
    Keyboard.dismiss()
    setIsAddressFocused(false)
  }

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

  function runPendingMenuAction () {
    const action = pendingMenuActionRef.current
    pendingMenuActionRef.current = null
    action?.()
  }

  const hiddenControlProps = isAddressFocused
    ? {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
        pointerEvents: 'none' as const
      }
    : {}

  const insets = useSafeAreaInsets()
  const toolbarBackground = isDark ? palette.surface : palette.shell

  return (
    // The bar and the list it opens are siblings in a stack with no padding of
    // its own, so "sit on the bar's edge" is the bar's measured height and
    // nothing else. Positioning the list inside the bar made that depend on
    // the bar's own padding, which is where the gap kept coming back.
    <View style={styles.browserToolbarStack}>
    <View style={[
      styles.browserToolbar,
      {
        backgroundColor: toolbarBackground,
        borderBottomColor: palette.border,
        // The bar itself reaches both screen edges; only its controls step in
        // around the notch when the phone is on its side.
        paddingLeft: TOOLBAR_SIDE_PADDING + insets.left,
        paddingRight: TOOLBAR_SIDE_PADDING + insets.right
      },
      position === 'bottom'
          ? {
              borderBottomWidth: 0,
              borderTopColor: palette.border,
              // The suggestion list sits flush on this edge, and a line between
              // them makes it read as a separate card rather than the address
              // bar opening out.
              borderTopWidth: isAddressFocused ? 0 : 1,
              paddingBottom: 8
            }
        : { borderBottomWidth: isAddressFocused ? 0 : 1 }
    ]} onLayout={(event) => setMenuOffset(event.nativeEvent.layout.height)}>
      <Animated.View
        {...hiddenControlProps}
        style={[
          styles.browserToolbarControlGroup,
          {
            opacity: addressFocusProgress.interpolate({
              inputRange: [0, 0.65, 1],
              outputRange: [1, 0, 0]
            }),
            transform: [{
              translateX: addressFocusProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -14]
              })
            }],
            width: addressFocusProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [toolbarControlsWidth, 0]
            })
          }
        ]}
      >
      <Pressable
        accessibilityLabel='Go back'
        style={[
          styles.browserNavButton,
          !canGoBack ? styles.browserNavButtonDisabled : null
        ]}
        onPress={() => {
          finishAddressEditing()
          onBack()
        }}
        disabled={!canGoBack}
      >
        <BackIcon
          width={TOOLBAR_ICON_SIZE}
          height={TOOLBAR_ICON_SIZE}
          color={palette.mutedText}
          stroke={palette.mutedText}
          strokeWidth={TOOLBAR_ICON_STROKE_WIDTH}
        />
      </Pressable>
      <Pressable
        accessibilityLabel='Go forward'
        style={[
          styles.browserNavButton,
          !canGoForward ? styles.browserNavButtonDisabled : null
        ]}
        onPress={() => {
          finishAddressEditing()
          onForward()
        }}
        disabled={!canGoForward}
      >
        <ForwardIcon
          width={TOOLBAR_ICON_SIZE}
          height={TOOLBAR_ICON_SIZE}
          color={palette.mutedText}
          stroke={palette.mutedText}
          strokeWidth={TOOLBAR_ICON_STROKE_WIDTH}
        />
      </Pressable>
      </Animated.View>
      <View style={[
        styles.browserAddressContainer,
        {
          backgroundColor: palette.address
        }
      ]}>
        {/* The one thing a padlock is for: whether anybody on the way can read
            this. Hidden while typing, where the address is being edited rather
            than describing a page. */}
        {showSiteSecurity && (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel='Connection information'
            hitSlop={8}
            onPress={onOpenSiteInfo}
            style={styles.browserSecurity}
          >
            {/* Same size, colour and weight as reload and share, on the same
                centre line, so the row reads as one set of controls rather
                than a badge somebody bolted on. */}
            {siteSecurity === SITE_SECURITY.INSECURE
              ? (
                <ShieldSlashIcon
                  width={ADDRESS_SECURITY_ICON_SIZE}
                  height={ADDRESS_SECURITY_ICON_SIZE}
                  color='#c2563f'
                  opacity={0.76}
                />
                )
              : (
                <ShieldLockIcon
                  width={ADDRESS_SECURITY_ICON_SIZE}
                  height={ADDRESS_SECURITY_ICON_SIZE}
                  color={addressActionIconColor}
                  opacity={0.76}
                />
                )}
          </Pressable>
        )}
        <TextInput
          ref={addressInputRef}
          accessibilityLabel='Browser address'
          style={[
            styles.browserAddress,
            showSiteSecurity ? styles.browserAddressBesideSecurity : null,
            { color: palette.text }
          ]}
          autoCapitalize='none'
          autoCorrect={false}
          keyboardType='url'
          returnKeyType='go'
          maxLength={MAX_BROWSER_URL_LENGTH}
          selection={isAddressFocused ? undefined : { start: 0, end: 0 }}
          value={isAddressFocused ? address : formatBrowserAddress(address, showFullAddress)}
          onFocus={() => {
            onCloseMenu()
            setIsAddressFocused(true)
          }}
          onBlur={() => setIsAddressFocused(false)}
          onChangeText={onAddressChange}
          onSubmitEditing={() => {
            addressInputRef.current?.blur()
            onSubmit()
          }}
          placeholder='Search or type'
          placeholderTextColor={palette.mutedText}
        />
        {isAddressFocused && address.length > 0 && (
          <Pressable
            accessibilityLabel='Clear address'
            accessibilityRole='button'
            hitSlop={4}
            style={[styles.browserAddressAction, styles.browserAddressClearAction]}
            onPress={() => {
              onAddressChange('')
              addressInputRef.current?.focus()
            }}
          >
            <ClearIcon
              width={ADDRESS_CLEAR_ICON_SIZE}
              height={ADDRESS_CLEAR_ICON_SIZE}
              color={palette.mutedText}
              stroke={palette.mutedText}
              strokeWidth={TOOLBAR_ICON_STROKE_WIDTH}
            />
          </Pressable>
        )}
        {!isAddressFocused && pageActionAvailable && (
          <View style={styles.browserAddressActions}>
            <Pressable
              accessibilityLabel={isLoading ? 'Stop loading page' : 'Reload page'}
              accessibilityRole='button'
              hitSlop={6}
              style={styles.browserAddressAction}
              onPress={onReload}
            >
              {isLoading
                ? <ActivityIndicator color={palette.accent} size='small' />
                : (
                  <ReloadIcon
                    width={ADDRESS_ACTION_ICON_SIZE}
                    height={ADDRESS_ACTION_ICON_SIZE}
                    color={addressActionIconColor}
                    opacity={0.76}
                    style={styles.browserAddressReloadIcon}
                  />
                  )}
            </Pressable>
            {shareActionAvailable && (
              <Pressable
                accessibilityLabel='Share page'
                accessibilityRole='button'
                hitSlop={6}
                style={styles.browserAddressAction}
                onPress={onSharePage}
              >
                <ShareIcon
                  width={ADDRESS_ACTION_ICON_SIZE}
                  height={ADDRESS_ACTION_ICON_SIZE}
                  color={addressActionIconColor}
                  opacity={0.76}
                  style={styles.browserAddressShareIcon}
                />
              </Pressable>
            )}
          </View>
        )}
      </View>
      <Animated.View
        {...hiddenControlProps}
        style={[
          styles.browserToolbarControlGroup,
          styles.browserToolbarTrailingControls,
          {
            opacity: addressFocusProgress.interpolate({
              inputRange: [0, 0.65, 1],
              outputRange: [1, 0, 0]
            }),
            transform: [{
              translateX: addressFocusProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 14]
              })
            }],
            width: addressFocusProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [toolbarControlsWidth, 0]
            })
          }
        ]}
      >
      <Pressable
        accessibilityLabel={`Open tabs, ${tabCount} open`}
        style={styles.browserTabCountButton}
        onPress={onOpenTabs}
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
        offset={menuOffset}
        position={position}
        shareActionAvailable={shareActionAvailable}
        visible={menuVisible}
        onClose={onCloseMenu}
        onNewTab={onNewTab}
        onOpenBookmarks={onOpenBookmarks}
        onOpenDownloads={onOpenDownloads}
        onOpenHistory={onOpenHistory}
        onOpenZoom={() => {
          onCloseMenu()
          onOpenZoom()
        }}
        onShow={onOpenMenu}
        onOpenSettings={onOpenSettings}
        onDismissed={runPendingMenuAction}
        onSharePage={() => afterMenuCloses(onSharePage)}
        onToggleDesktopView={() => {
          onCloseMenu()
          onToggleDesktopView()
        }}
        onToggleBookmark={onToggleBookmark}
      />
      </Animated.View>
    </View>
    {isAddressFocused && (
      <HistorySuggestions
        background={toolbarBackground}
        items={historySuggestions}
        offset={menuOffset}
        palette={palette}
        position={position}
        onOpen={(url) => {
          addressInputRef.current?.blur()
          setIsAddressFocused(false)
          onSuggestionPress(url)
        }}
      />
    )}
    </View>
  )
}
