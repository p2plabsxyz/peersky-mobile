import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native'
import { MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'
import { formatBrowserAddress } from './browser-appearance.mjs'
import { BrowserOverflowMenu } from './settings/BrowserOverflowMenu'
import { HistorySuggestions } from './history/HistorySuggestions'
import type { BrowserHistoryItem } from './history/useBrowserHistory'
import { styles } from './styles'
import ReloadIcon from '../assets/icons/bootstrap/arrow-clockwise.svg'
import BackIcon from '../assets/icons/bootstrap/arrow-left.svg'
import ForwardIcon from '../assets/icons/bootstrap/arrow-right.svg'
import ShareIcon from '../assets/icons/bootstrap/arrow-bar-up.svg'
import ClearIcon from '../assets/icons/bootstrap/x-circle.svg'

const TOOLBAR_ICON_SIZE = 22
const ADDRESS_ACTION_ICON_SIZE = 20
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
  showFullAddress: boolean
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
  showFullAddress,
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

  const hiddenControlProps = isAddressFocused
    ? {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
        pointerEvents: 'none' as const
      }
    : {}

  return (
    <View style={[
      styles.browserToolbar,
      {
        backgroundColor: isDark ? palette.surface : palette.shell,
        borderBottomColor: palette.border
      },
      position === 'bottom'
          ? {
              borderBottomWidth: 0,
              borderTopColor: palette.border,
              borderTopWidth: 1,
              paddingBottom: 8
            }
        : null
    ]} onLayout={(event) => setMenuOffset(event.nativeEvent.layout.height + 4)}>
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
        <TextInput
          ref={addressInputRef}
          accessibilityLabel='Browser address'
          style={[styles.browserAddress, { color: palette.text }]}
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
        {!isAddressFocused && shareActionAvailable && (
          <View style={styles.browserAddressActions}>
            <Pressable
              accessibilityLabel={isLoading ? 'Stop loading page' : 'Reload page'}
              accessibilityRole='button'
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
            <Pressable
              accessibilityLabel='Share page'
              accessibilityRole='button'
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
          </View>
        )}
      </View>
      {isAddressFocused && (
        <HistorySuggestions
          items={historySuggestions}
          palette={palette}
          position={position}
          onOpen={(url) => {
            addressInputRef.current?.blur()
            setIsAddressFocused(false)
            onSuggestionPress(url)
          }}
        />
      )}
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
        onSharePage={() => {
          onCloseMenu()
          onSharePage()
        }}
        onToggleDesktopView={() => {
          onCloseMenu()
          onToggleDesktopView()
        }}
        onToggleBookmark={onToggleBookmark}
      />
      </Animated.View>
    </View>
  )
}
