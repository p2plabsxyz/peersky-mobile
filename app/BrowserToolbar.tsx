import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native'
import { MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'
import { formatBrowserAddress } from './browser-appearance.mjs'
import { BrowserOverflowMenu } from './settings/BrowserOverflowMenu'
import { styles } from './styles'
import ShareIcon from '../assets/icons/bootstrap/share.svg'

type BrowserToolbarProps = {
  address: string
  bookmarkActionAvailable: boolean
  bookmarksDisabled: boolean
  canGoBack: boolean
  canGoForward: boolean
  desktopView: boolean
  isBookmarked: boolean
  isDark: boolean
  isLoading: boolean
  menuVisible: boolean
  newTabDisabled: boolean
  palette: {
    accent: string
    address: string
    border: string
    button: string
    mutedText: string
    shell: string
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
  onOpenSettings: () => void
  onOpenTabs: () => void
  onOpenZoom: () => void
  onReload: () => void
  onSharePage: () => void
  onSubmit: () => void
  onToggleDesktopView: () => void
  onToggleBookmark: () => void
}

export function BrowserToolbar ({
  address,
  bookmarkActionAvailable,
  bookmarksDisabled,
  canGoBack,
  canGoForward,
  desktopView,
  isBookmarked,
  isDark,
  isLoading,
  menuVisible,
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
  onOpenSettings,
  onOpenTabs,
  onOpenZoom,
  onReload,
  onSharePage,
  onSubmit,
  onToggleDesktopView,
  onToggleBookmark
}: BrowserToolbarProps) {
  const [isAddressFocused, setIsAddressFocused] = useState(false)
  const [menuOffset, setMenuOffset] = useState(70)
  const addressInputRef = useRef<TextInput>(null)
  const addressFocusProgress = useRef(new Animated.Value(0)).current
  const trailingControlsWidth = shareActionAvailable ? 182 : 137

  useEffect(() => {
    const animation = Animated.timing(addressFocusProgress, {
      duration: 180,
      toValue: isAddressFocused ? 1 : 0,
      useNativeDriver: false
    })
    animation.start()

    return () => animation.stop()
  }, [addressFocusProgress, isAddressFocused])

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
        backgroundColor: palette.shell,
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
              outputRange: [82, 0]
            })
          }
        ]}
      >
      <Pressable
        accessibilityLabel='Go back'
        style={[
          styles.browserNavButton,
          { backgroundColor: palette.button },
          !canGoBack ? styles.browserNavButtonDisabled : null
        ]}
        onPress={onBack}
        disabled={!canGoBack}
      >
        <Text style={[styles.browserNavButtonText, { color: palette.text }]}>{'<'}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel='Go forward'
        style={[
          styles.browserNavButton,
          { backgroundColor: palette.button },
          !canGoForward ? styles.browserNavButtonDisabled : null
        ]}
        onPress={onForward}
        disabled={!canGoForward}
      >
        <Text style={[styles.browserNavButtonText, { color: palette.text }]}>{'>'}</Text>
      </Pressable>
      </Animated.View>
      <TextInput
        ref={addressInputRef}
        accessibilityLabel='Browser address'
        style={[
          styles.browserAddress,
          {
            backgroundColor: palette.address,
            borderColor: palette.border,
            color: palette.text
          }
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
              outputRange: [trailingControlsWidth, 0]
            })
          }
        ]}
      >
      <Pressable
        accessibilityLabel={isLoading ? 'Page loading' : 'Reload page'}
        style={[styles.browserActionButton, { backgroundColor: palette.accent }]}
        onPress={onReload}
      >
        {isLoading
          ? <ActivityIndicator color='#ffffff' size='small' />
          : <Text style={styles.browserActionButtonText}>↻</Text>}
      </Pressable>
      {shareActionAvailable && (
        <Pressable
          accessibilityLabel='Share page'
          accessibilityRole='button'
          style={[styles.browserShareButton, { backgroundColor: palette.button }]}
          onPress={onSharePage}
        >
          <ShareIcon width={18} height={18} color={palette.text} />
        </Pressable>
      )}
      <Pressable
        accessibilityLabel={`Open tabs, ${tabCount} open`}
        style={[styles.browserTabCountButton, { backgroundColor: palette.button }]}
        onPress={onOpenTabs}
      >
        <View style={[styles.browserTabCountIcon, { borderColor: palette.text }]}>
          <Text style={[styles.browserTabCountText, { color: palette.text }]}>{tabCount}</Text>
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
        onOpenZoom={() => {
          onCloseMenu()
          onOpenZoom()
        }}
        onShow={onOpenMenu}
        onOpenSettings={onOpenSettings}
        onReload={() => {
          onCloseMenu()
          onReload()
        }}
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
