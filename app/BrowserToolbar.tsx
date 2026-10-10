import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, type Animated, Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { getBrowserAddressForUrl, MAX_BROWSER_URL_LENGTH } from './browser-shell.mjs'
import { formatBrowserAddress } from './browser-appearance.mjs'
import { getSiteSecurity, SITE_SECURITY } from './site-security.mjs'
import IncognitoIcon from '../assets/icons/bootstrap/incognito.svg'
import ShieldCheckIcon from '../assets/icons/bootstrap/shield-check.svg'
import ShieldSlashIcon from '../assets/icons/bootstrap/shield-slash.svg'
import { BrowserLoadProgress } from './BrowserLoadProgress'
import { HistorySuggestions, type OneOffSearchEngine } from './history/HistorySuggestions'
import type { BrowserHistoryItem } from './history/useBrowserHistory'
import { useSearchSuggestions } from './search/useSearchSuggestions'
import { dimWhenPressed, ROUND_PRESS, SMALL_ICON_RIPPLE } from './press-feedback'
import { styles } from './styles'
import ReloadIcon from '../assets/icons/bootstrap/arrow-clockwise.svg'
import ShareIcon from '../assets/icons/bootstrap/arrow-bar-up.svg'
import StarIcon from '../assets/icons/bootstrap/star.svg'
import StarFillIcon from '../assets/icons/bootstrap/star-fill.svg'
import ClearIcon from '../assets/icons/bootstrap/x-circle.svg'

const ADDRESS_ACTION_ICON_SIZE = 22
// The shield is a solid glyph filling its box, while reload and share are
// thin outlines. Drawn at the same number it reads as the larger of the
// three, so it is drawn smaller to look the same size.
const ADDRESS_SECURITY_ICON_SIZE = 20
// x-circle fills its box the way the shield does, while the reload and
// share arrows do not, so it is drawn at the shield's size to look the
// same as all three.
const ADDRESS_CLEAR_ICON_SIZE = ADDRESS_SECURITY_ICON_SIZE
// The star is drawn as an outline like reload and share, at the size that
// matches them by eye.
const ADDRESS_STAR_ICON_SIZE = 20
const TOOLBAR_ICON_STROKE_WIDTH = 0.35

// Matches browserToolbar's own paddingHorizontal.
const TOOLBAR_SIDE_PADDING = 14
// Long enough for a new tab to settle and for the app to be in front when a
// widget opened it. The keyboard does not come up for a window that is not.
const FOCUS_REQUEST_DELAY_MS = 350

type BrowserToolbarProps = {
  activeTabId: string
  address: string
  // One tap to bookmark the page, which took opening the menu first.
  bookmarkActionAvailable?: boolean
  currentUrl: string
  // Each new value puts the cursor in the box: the search widget.
  focusRequest?: number
  historySuggestions: BrowserHistoryItem[]
  isBookmarked?: boolean
  isDark: boolean
  isIncognito?: boolean
  isLoading: boolean
  // How far the page has loaded, from 0 to 1, for the line along the bar.
  loadProgress?: Animated.Value
  navigationKey: string
  pageActionAvailable: boolean
  palette: {
    accent: string
    address: string
    border: string
    button: string
    mutedText: string
    seam: string
    shell: string
    surface: string
    text: string
  }
  position: 'top' | 'bottom'
  // The engine chosen in Settings, and the others to search with once.
  searchEngine: string
  searchEngines: OneOffSearchEngine[]
  searchSuggestionsEnabled: boolean
  shareActionAvailable: boolean
  showFullAddress: boolean
  onAddressChange: (address: string) => void
  onCloseMenu: () => void
  onOpenSiteInfo: () => void
  onReload: () => void
  onSharePage: () => void
  onSearch: (text: string, searchEngine?: string) => void
  onSubmit: () => void
  onSuggestionPress: (url: string) => void
  onToggleBookmark?: () => void
}

/**
 * The address bar, and only the address bar.
 *
 * Where you are, and the two things you do to the page you are on. Back,
 * forward, tabs and the menu live on their own bar at the bottom, within
 * reach, which is also what lets this one move to whichever end you want it.
 */
export function BrowserToolbar ({
  activeTabId,
  address,
  bookmarkActionAvailable = false,
  currentUrl,
  focusRequest = 0,
  historySuggestions,
  isBookmarked = false,
  isDark,
  isIncognito = false,
  isLoading,
  loadProgress,
  navigationKey,
  pageActionAvailable,
  palette,
  position,
  searchEngine,
  searchEngines,
  searchSuggestionsEnabled,
  shareActionAvailable,
  showFullAddress,
  onAddressChange,
  onCloseMenu,
  onOpenSiteInfo,
  onReload,
  onSharePage,
  onSearch,
  onSubmit,
  onSuggestionPress,
  onToggleBookmark
}: BrowserToolbarProps) {
  const [isAddressFocused, setIsAddressFocused] = useState(false)
  // The page that loaded, not the text in the box: once you type an address
  // and tap away without going there, the two disagree.
  const siteSecurity = getSiteSecurity(getBrowserAddressForUrl(currentUrl))
  const showSiteSecurity = !isAddressFocused && siteSecurity !== SITE_SECURITY.UNKNOWN
  const [barHeight, setBarHeight] = useState(70)
  const addressInputRef = useRef<TextInput>(null)
  const addressActionIconColor = palette.mutedText
  const insets = useSafeAreaInsets()
  const toolbarBackground = isDark ? palette.surface : palette.shell
  // The suggestion list sits flush on this edge, so a line between them makes
  // it read as a separate card rather than the address bar opening out.
  const seamColor = isAddressFocused ? 'transparent' : palette.seam
  const searches = useSearchSuggestions(address, {
    active: isAddressFocused,
    enabled: searchSuggestionsEnabled,
    incognito: isIncognito,
    searchEngine
  })
  // Once something is typed. An address the bar already shows, with its
  // scheme, is where you are rather than something to search for.
  const oneOffSearchEngines = /^[a-z][a-z0-9+.-]*:\/\//i.test(address.trim()) ? [] : searchEngines

  useEffect(() => {
    addressInputRef.current?.blur()
    Keyboard.dismiss()
    setIsAddressFocused(false)
  }, [activeTabId, navigationKey])

  // After the blur above, which a new tab sets off in the same render.
  useEffect(() => {
    if (!focusRequest) return
    const timer = setTimeout(() => addressInputRef.current?.focus(), FOCUS_REQUEST_DELAY_MS)
    return () => clearTimeout(timer)
  }, [focusRequest])

  return (
    // The bar and the list it opens are siblings in a stack with no padding of
    // its own, so "sit on the bar's edge" is the bar's measured height and
    // nothing else. Positioning the list inside the bar made that depend on
    // the bar's own padding, which is where the gap kept coming back.
    <View style={styles.browserToolbarStack}>
      <View
        style={[
          styles.browserToolbar,
          {
            backgroundColor: toolbarBackground,
            // The bar itself reaches both screen edges; only its controls step
            // in around the notch when the phone is on its side.
            paddingLeft: TOOLBAR_SIDE_PADDING + insets.left,
            paddingRight: TOOLBAR_SIDE_PADDING + insets.right
          },
          // The seam is always the same hairline, and only its colour changes.
          // Taking the border away while the suggestion list is open moved
          // everything below it by a pixel, which on a photograph is a jump
          // you can see.
          position === 'bottom'
            ? {
                borderBottomWidth: 0,
                borderTopColor: seamColor,
                borderTopWidth: StyleSheet.hairlineWidth
              }
            : {
                borderBottomColor: seamColor,
                borderBottomWidth: StyleSheet.hairlineWidth
              }
        ]}
        onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
      >
        {loadProgress && (
          <BrowserLoadProgress
            color={palette.accent}
            edge={position === 'bottom' ? 'top' : 'bottom'}
            isLoading={isLoading && !isAddressFocused}
            progress={loadProgress}
          />
        )}
        <View style={[styles.browserAddressContainer, { backgroundColor: palette.address }]}>
          {isIncognito && (
            <View
              accessible
              accessibilityLabel='Incognito tab'
              style={styles.browserSecurity}
            >
              <IncognitoIcon
                width={ADDRESS_SECURITY_ICON_SIZE}
                height={ADDRESS_SECURITY_ICON_SIZE}
                color={addressActionIconColor}
              />
            </View>
          )}
          {/* The one thing a padlock is for: whether anybody on the way can
              read this. Hidden while typing, where the address is being
              edited rather than describing a page. */}
          {showSiteSecurity && (
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Connection information'
              android_ripple={SMALL_ICON_RIPPLE}
              hitSlop={8}
              onPress={onOpenSiteInfo}
              style={({ pressed }) => [styles.browserSecurity, ROUND_PRESS, dimWhenPressed(pressed)]}
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
                  <ShieldCheckIcon
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
            // The bar takes searches as well as addresses. iOS's URL keyboard
            // has no space bar on its letters, so it gets Safari's web search
            // keyboard: a space, a full stop and Go.
            keyboardType={Platform.OS === 'ios' ? 'web-search' : 'url'}
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
            placeholder='Search or enter address'
            placeholderTextColor={palette.mutedText}
          />
          {isAddressFocused && address.length > 0 && (
            <Pressable
              accessibilityLabel='Clear address'
              accessibilityRole='button'
              android_ripple={SMALL_ICON_RIPPLE}
              hitSlop={4}
              style={({ pressed }) => [styles.browserAddressAction, styles.browserAddressClearAction, ROUND_PRESS, dimWhenPressed(pressed)]}
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
              {bookmarkActionAvailable && onToggleBookmark && (
                <Pressable
                  accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Bookmark page'}
                  accessibilityRole='button'
                  accessibilityState={{ selected: isBookmarked }}
                  android_ripple={SMALL_ICON_RIPPLE}
                  hitSlop={6}
                  style={({ pressed }) => [styles.browserAddressAction, ROUND_PRESS, dimWhenPressed(pressed)]}
                  onPress={onToggleBookmark}
                >
                  {isBookmarked
                    ? (
                      <StarFillIcon
                        width={ADDRESS_STAR_ICON_SIZE}
                        height={ADDRESS_STAR_ICON_SIZE}
                        color={palette.accent}
                      />
                      )
                    : (
                      <StarIcon
                        width={ADDRESS_STAR_ICON_SIZE}
                        height={ADDRESS_STAR_ICON_SIZE}
                        color={addressActionIconColor}
                        opacity={0.76}
                      />
                      )}
                </Pressable>
              )}
              <Pressable
                accessibilityLabel={isLoading ? 'Stop loading page' : 'Reload page'}
                accessibilityRole='button'
                android_ripple={SMALL_ICON_RIPPLE}
                hitSlop={6}
                style={({ pressed }) => [styles.browserAddressAction, ROUND_PRESS, dimWhenPressed(pressed)]}
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
                  android_ripple={SMALL_ICON_RIPPLE}
                  hitSlop={6}
                  style={({ pressed }) => [styles.browserAddressAction, ROUND_PRESS, dimWhenPressed(pressed)]}
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
      </View>
      {isAddressFocused && (
        <HistorySuggestions
          background={toolbarBackground}
          items={historySuggestions}
          offset={barHeight}
          palette={palette}
          position={position}
          query={address}
          searches={searches}
          searchEngines={oneOffSearchEngines}
          onFill={(text) => onAddressChange(`${text} `)}
          onOpen={(url) => {
            addressInputRef.current?.blur()
            setIsAddressFocused(false)
            onSuggestionPress(url)
          }}
          onSearch={(text, engine) => {
            addressInputRef.current?.blur()
            setIsAddressFocused(false)
            onSearch(text, engine)
          }}
        />
      )}
    </View>
  )
}
