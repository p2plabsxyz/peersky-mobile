import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  FlatList,
  Image,
  type ImageSourcePropType,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  type StyleProp,
  Text,
  UIManager,
  type ViewStyle,
  View
} from 'react-native'
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context'
import type { BrowserTabPreview } from './useBrowserTabPreviews'
import { styles } from '../styles'
import { BrowserToast, type BrowserToastMessage } from '../BrowserToast'
import CheckIcon from '../../assets/icons/bootstrap/check2.svg'
import ChevronLeftIcon from '../../assets/icons/bootstrap/chevron-left.svg'
import ClockHistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import CopyIcon from '../../assets/icons/bootstrap/copy.svg'
import FireIcon from '../../assets/icons/bootstrap/fire.svg'
import GridIcon from '../../assets/icons/bootstrap/grid.svg'
import ListIcon from '../../assets/icons/bootstrap/list-ul.svg'
import MoreIcon from '../../assets/icons/bootstrap/three-dots-vertical.svg'
import PlusIcon from '../../assets/icons/bootstrap/plus-lg.svg'
import ShareIcon from '../../assets/icons/bootstrap/arrow-bar-up.svg'
import CloseIcon from '../../assets/icons/bootstrap/x-lg.svg'
import { isHorizontalSwipe, shouldCloseOnRelease } from './tab-swipe.mjs'
import { formatClosedTabTime } from './recently-closed-time.mjs'
import { MODAL_ORIENTATIONS } from '../modal-orientations'

const TAB_ACTION_ICON_SIZE = 21
const TAB_ACTION_ICON_STROKE_WIDTH = 0.35

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

type BrowserTabManagerItem = {
  favicon: ImageSourcePropType | string | null
  id: string
  isActive: boolean
  label: string
  preview: BrowserTabPreview | null
}

type BrowserTabsPalette = {
  address: string
  border: string
  button: string
  mutedText: string
  shell: string
  text: string
}

type TabFaviconProps = {
  favicon: ImageSourcePropType | string | null
  label: string
  palette: BrowserTabsPalette
  size: 'header' | 'preview'
}

type RecentlyClosedTab = {
  key: string
  title: string
  url: string
  closedAt: number
}

type BrowserTabsScreenProps = {
  isDark: boolean
  items: BrowserTabManagerItem[]
  newTabDisabled: boolean
  palette: BrowserTabsPalette
  recentlyClosed: RecentlyClosedTab[]
  viewMode: 'grid' | 'list'
  visible: boolean
  onBurnTabs: () => void
  onClearRecentlyClosed: () => void
  onClose: () => void
  onCloseAllTabs: () => void
  // The closed tab's key in Recently closed, for Undo, or null when there is
  // nothing to bring back.
  onCloseTab: (tabId: string) => string | null
  onCloseTabs: (tabIds: string[]) => string[]
  // How many links went to the clipboard.
  onCopyTabLinks: (tabIds: string[]) => number
  onNewTab: () => void
  onPreviewError: (tabId: string) => void
  onReopenClosedTab: (key: string, options?: { restorePlace?: boolean }) => void
  onReopenClosedTabs: (keys: string[]) => void
  onShareTabLinks: (tabIds: string[]) => void
  onSwitchTab: (tabId: string) => void
  onToggleView: () => void
}

export function BrowserTabsScreen ({
  isDark,
  items,
  newTabDisabled,
  palette,
  recentlyClosed,
  viewMode,
  visible,
  onBurnTabs,
  onClearRecentlyClosed,
  onClose,
  onCloseAllTabs,
  onCloseTab,
  onCloseTabs,
  onCopyTabLinks,
  onNewTab,
  onPreviewError,
  onReopenClosedTab,
  onReopenClosedTabs,
  onShareTabLinks,
  onSwitchTab,
  onToggleView
}: BrowserTabsScreenProps) {
  // The tabs, or the list of recently closed ones.
  const [panel, setPanel] = useState<'tabs' | 'closed'>('tabs')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState<BrowserToastMessage | null>(null)
  // Picking several tabs to copy, share or close at once. Null when not.
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const selecting = selected !== null
  const selectedIds = items.filter((item) => selected?.has(item.id)).map((item) => item.id)

  function toggleSelected (tabId: string) {
    setSelected((current) => {
      const next = new Set(current || [])
      if (next.has(tabId)) next.delete(tabId)
      else next.add(tabId)
      return next
    })
  }

  function closeSelected () {
    const keys = onCloseTabs(selectedIds)
    setSelected(null)
    if (keys.length === 0) return
    setToast({
      id: Date.now(),
      message: keys.length === 1 ? 'Tab closed' : `${keys.length} tabs closed`,
      actionLabel: 'Undo',
      onAction: () => onReopenClosedTabs(keys)
    })
  }
  const isList = viewMode === 'list'
  const actionIconProps = {
    color: palette.text,
    height: TAB_ACTION_ICON_SIZE,
    stroke: palette.text,
    strokeWidth: TAB_ACTION_ICON_STROKE_WIDTH,
    width: TAB_ACTION_ICON_SIZE
  }
  const primaryActionIconProps = {
    ...actionIconProps,
    color: '#ffffff',
    stroke: '#ffffff'
  }
  // The layout animation is configured by the close handler instead: closing
  // the active tab can swap the whole screen, and only the caller knows when.
  // A tab closed here can come straight back, as in Firefox.
  const closeTab = (tabId: string) => {
    const key = onCloseTab(tabId)
    if (!key) return
    setToast({
      id: Date.now(),
      message: 'Tab closed',
      actionLabel: 'Undo',
      onAction: () => onReopenClosedTab(key, { restorePlace: true })
    })
  }

  useEffect(() => {
    if (visible) return
    setPanel('tabs')
    setMenuOpen(false)
    setToast(null)
    setSelected(null)
  }, [visible])

  // Tabs stay in the order they were opened, newest last, as in Chrome and
  // Safari, and the screen opens on the tab you are on. A long list used to
  // open at the oldest tab, which looked like the newest had gone missing.
  const listRef = useRef<FlatList<BrowserTabManagerItem>>(null)
  const scrolledToActiveRef = useRef(false)
  const scrollRetriesRef = useRef(0)
  const activeIndex = items.findIndex((item) => item.isActive)
  const activeRow = activeIndex < 0 ? 0 : isList ? activeIndex : Math.floor(activeIndex / 2)

  useEffect(() => {
    if (!visible) scrolledToActiveRef.current = false
  }, [visible])

  useEffect(() => {
    scrolledToActiveRef.current = false
  }, [viewMode])

  function scrollToActiveTab () {
    if (scrolledToActiveRef.current) return
    scrolledToActiveRef.current = true
    scrollRetriesRef.current = 0
    if (activeRow > 0) {
      listRef.current?.scrollToIndex({ index: activeRow, viewPosition: 0.5, animated: false })
    }
  }

  return (
    <Modal
      supportedOrientations={MODAL_ORIENTATIONS}
      animationType='slide'
      visible={visible}
      onRequestClose={onClose}
    >
      {/* A react-native Modal is its own root view, so the insets from the app's
          SafeAreaProvider do not reach inside it and the header rendered under
          the status bar and Dynamic Island. Provide them again here, seeded
          with the window metrics so the very first frame is already correct. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView
          style={[styles.browserTabsScreen, { backgroundColor: palette.shell }]}
          edges={['top', 'left', 'right', 'bottom']}
        >
        {panel === 'closed'
          ? (
            <RecentlyClosedPanel
              items={recentlyClosed}
              palette={palette}
              onBack={() => setPanel('tabs')}
              onClear={onClearRecentlyClosed}
              onReopen={(key) => onReopenClosedTab(key)}
            />
            )
          : (
            <>
        {selecting
          ? (
            <View style={[styles.browserTabsHeader, { borderBottomColor: palette.border }]}>
              <View>
                <Text style={[styles.browserTabsTitle, { color: palette.text }]}>
                  {selectedIds.length} selected
                </Text>
                <Text style={[styles.browserTabsSubtitle, { color: palette.mutedText }]}>
                  Tap tabs to pick them
                </Text>
              </View>
              <View style={local.selectionHeaderActions}>
                <Pressable
                  accessibilityRole='button'
                  hitSlop={8}
                  onPress={() => setSelected(
                    selectedIds.length === items.length ? new Set() : new Set(items.map((item) => item.id))
                  )}
                >
                  <Text style={[local.headerTextButton, { color: palette.text }]}>
                    {selectedIds.length === items.length ? 'None' : 'All'}
                  </Text>
                </Pressable>
                <Pressable accessibilityRole='button' hitSlop={8} onPress={() => setSelected(null)}>
                  <Text style={[local.headerTextButton, local.headerTextButtonStrong]}>Done</Text>
                </Pressable>
              </View>
            </View>
            )
          : (
        <View style={[styles.browserTabsHeader, { borderBottomColor: palette.border }]}>
          <View>
            <Text style={[styles.browserTabsTitle, { color: palette.text }]}>Tabs</Text>
            <Text style={[styles.browserTabsSubtitle, { color: palette.mutedText }]}>
              {items.length} open
            </Text>
          </View>
          <View style={styles.browserTabsHeaderActions}>
            <Pressable
              accessibilityLabel={isList ? 'Switch to grid view' : 'Switch to list view'}
              accessibilityRole='button'
              style={[styles.browserTabsViewButton, { backgroundColor: palette.button }]}
              onPress={onToggleView}
            >
              {isList
                ? <GridIcon {...actionIconProps} />
                : <ListIcon {...actionIconProps} />}
            </Pressable>
            <Pressable
              accessibilityLabel='Burn tabs, history and cached data'
              accessibilityRole='button'
              style={styles.browserTabsBurnButton}
              onPress={onBurnTabs}
            >
              <FireIcon {...primaryActionIconProps} />
            </Pressable>
            {/* Close all lives in here now, with the tab list's other
                occasional actions, so the bar keeps four buttons on a
                narrow phone. */}
            <Pressable
              accessibilityLabel='More tab actions'
              accessibilityRole='button'
              accessibilityState={{ expanded: menuOpen }}
              style={[styles.browserTabsViewButton, { backgroundColor: palette.button }]}
              onPress={() => setMenuOpen((open) => !open)}
            >
              <MoreIcon {...actionIconProps} />
            </Pressable>
            <Pressable
              accessibilityLabel='Open new tab'
              accessibilityRole='button'
              accessibilityState={{ disabled: newTabDisabled }}
              style={[
                styles.browserTabsNewButton,
                newTabDisabled ? styles.browserTabsNewButtonDisabled : null
              ]}
              onPress={onNewTab}
              disabled={newTabDisabled}
            >
              <PlusIcon {...primaryActionIconProps} />
            </Pressable>
          </View>
        </View>
            )}

        <FlatList
          ref={listRef}
          key={`browser-tabs-${viewMode}`}
          data={items}
          onLayout={scrollToActiveTab}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            // Rows past the first few are not measured yet: jump near the row,
            // then once it is drawn, centre it.
            listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false })
            if (scrollRetriesRef.current++ < 2) {
              setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), 60)
            }
          }}
          keyExtractor={(item) => item.id}
          numColumns={isList ? 1 : 2}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          removeClippedSubviews={Platform.OS === 'android'}
          windowSize={5}
          columnWrapperStyle={isList ? undefined : styles.browserTabsGridRow}
          contentContainerStyle={[
            styles.browserTabsGrid,
            isList ? styles.browserTabsList : null
          ]}
          renderItem={({ item }) => (
            <SwipeableTabCard
              disabled={selecting}
              onClose={() => closeTab(item.id)}
              style={[
                styles.browserTabCard,
                {
                  backgroundColor: palette.address,
                  borderColor: palette.border
                },
                isList ? styles.browserTabCardList : null,
                (selecting ? selected?.has(item.id) : item.isActive) ? styles.browserTabCardActive : null
              ]}
            >
              <Pressable
                accessibilityLabel={selecting ? `Select ${item.label} tab` : `Open ${item.label} tab`}
                accessibilityRole={selecting ? 'checkbox' : 'button'}
                accessibilityState={selecting ? { checked: selected?.has(item.id) } : { selected: item.isActive }}
                accessibilityHint={selecting ? undefined : 'Press and hold to select several tabs'}
                delayLongPress={350}
                style={[
                  styles.browserTabCardBody,
                  isList ? styles.browserTabCardBodyList : null
                ]}
                onLongPress={() => {
                  if (selecting) return
                  setMenuOpen(false)
                  setSelected(new Set([item.id]))
                }}
                onPress={() => selecting ? toggleSelected(item.id) : onSwitchTab(item.id)}
              >
                <View style={[
                  styles.browserTabCardDetails,
                  isList ? styles.browserTabCardDetailsList : null
                ]}>
                  <TabFavicon
                    favicon={item.favicon}
                    label={item.label}
                    palette={palette}
                    size='header'
                  />
                  <Text
                    style={[styles.browserTabCardTitle, { color: palette.text }]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </View>

                <View style={[
                  styles.browserTabCardPreview,
                  { backgroundColor: palette.button },
                  item.preview ? styles.browserTabCardPreviewWithThumbnail : null,
                  isList ? styles.browserTabCardPreviewList : null
                ]}>
                  {item.preview
                    ? (
                      <Image
                        accessibilityIgnoresInvertColors
                        source={{ uri: item.preview.uri }}
                        style={[
                          styles.browserTabCardThumbnail,
                          { aspectRatio: item.preview.aspectRatio }
                        ]}
                        onError={() => onPreviewError(item.id)}
                      />
                      )
                    : item.favicon
                      ? <TabFavicon
                          favicon={item.favicon}
                          label={item.label}
                          palette={palette}
                          size='preview'
                        />
                      : (
                        <Text
                          style={[
                            styles.browserTabCardPreviewText,
                            { color: palette.mutedText }
                          ]}
                          numberOfLines={2}
                        >
                          {item.label}
                        </Text>
                        )}
                </View>
              </Pressable>

              {selecting
                ? (
                  <View
                    pointerEvents='none'
                    style={[
                      styles.browserTabCardClose,
                      local.selectMark,
                      selected?.has(item.id)
                        ? local.selectMarkOn
                        : { backgroundColor: palette.address, borderColor: palette.mutedText }
                    ]}
                  >
                    {selected?.has(item.id) && <CheckIcon width={16} height={16} color='#ffffff' />}
                  </View>
                  )
                : (
                  <Pressable
                    accessibilityLabel={`Close ${item.label}`}
                    accessibilityRole='button'
                    hitSlop={8}
                    style={[styles.browserTabCardClose, { backgroundColor: palette.button }]}
                    onPress={() => closeTab(item.id)}
                  >
                    <CloseIcon {...actionIconProps} width={17} height={17} />
                  </Pressable>
                  )}
            </SwipeableTabCard>
          )}
        />
        {selecting && (
          <View style={[local.selectionBar, { backgroundColor: palette.shell, borderTopColor: palette.border }]}>
            <SelectionAction
              disabled={selectedIds.length === 0}
              icon={<CopyIcon width={18} height={18} color={palette.text} />}
              label='Copy links'
              palette={palette}
              onPress={() => {
                const count = onCopyTabLinks(selectedIds)
                setSelected(null)
                setToast({
                  id: Date.now(),
                  message: count === 0 ? 'No links to copy' : count === 1 ? 'Link copied' : `${count} links copied`
                })
              }}
            />
            <SelectionAction
              disabled={selectedIds.length === 0}
              icon={<ShareIcon width={18} height={18} color={palette.text} />}
              label='Share'
              palette={palette}
              onPress={() => {
                onShareTabLinks(selectedIds)
                setSelected(null)
              }}
            />
            <SelectionAction
              destructive
              disabled={selectedIds.length === 0}
              icon={<CloseIcon width={16} height={16} color='#d44a3a' />}
              label={selectedIds.length > 1 ? `Close ${selectedIds.length}` : 'Close'}
              palette={palette}
              onPress={closeSelected}
            />
          </View>
        )}
            </>
            )}
        {menuOpen && (
          <TabsMenu
            palette={palette}
            recentlyClosedCount={recentlyClosed.length}
            onSelect={() => {
              setMenuOpen(false)
              setSelected(new Set())
            }}
            onClose={() => setMenuOpen(false)}
            onCloseAll={() => {
              setMenuOpen(false)
              onCloseAllTabs()
            }}
            onRecentlyClosed={() => {
              setMenuOpen(false)
              setPanel('closed')
            }}
          />
        )}
        <BrowserToast bottom={selecting ? 92 : 24} isDark={isDark} toast={toast} onHide={() => setToast(null)} />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  )
}

// The tab list's occasional actions, under the button that opens them.
function TabsMenu ({
  palette,
  recentlyClosedCount,
  onClose,
  onCloseAll,
  onRecentlyClosed,
  onSelect
}: {
  palette: BrowserTabsPalette
  recentlyClosedCount: number
  onClose: () => void
  onCloseAll: () => void
  onRecentlyClosed: () => void
  onSelect: () => void
}) {
  return (
    <Pressable accessibilityLabel='Close menu' style={StyleSheet.absoluteFill} onPress={onClose}>
      <View
        accessibilityRole='menu'
        style={[local.menu, { backgroundColor: palette.address, borderColor: palette.border }]}
      >
        <Pressable
          accessibilityRole='menuitem'
          style={({ pressed }) => [local.menuItem, pressed ? { backgroundColor: palette.button } : null]}
          onPress={onSelect}
        >
          <CheckIcon width={18} height={18} color={palette.text} />
          <Text style={[local.menuText, { color: palette.text }]}>Select tabs</Text>
        </Pressable>
        <Pressable
          accessibilityRole='menuitem'
          style={({ pressed }) => [local.menuItem, pressed ? { backgroundColor: palette.button } : null]}
          onPress={onRecentlyClosed}
        >
          <ClockHistoryIcon width={18} height={18} color={palette.text} />
          <Text style={[local.menuText, { color: palette.text }]}>Recently closed tabs</Text>
          {recentlyClosedCount > 0 && (
            <Text style={[local.menuCount, { color: palette.mutedText }]}>{recentlyClosedCount}</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole='menuitem'
          style={({ pressed }) => [local.menuItem, pressed ? { backgroundColor: palette.button } : null]}
          onPress={onCloseAll}
        >
          <CloseIcon width={17} height={17} color={palette.text} />
          <Text style={[local.menuText, { color: palette.text }]}>Close all tabs</Text>
        </Pressable>
      </View>
    </Pressable>
  )
}

function SelectionAction ({
  destructive = false,
  disabled,
  icon,
  label,
  palette,
  onPress
}: {
  destructive?: boolean
  disabled: boolean
  icon: ReactNode
  label: string
  palette: BrowserTabsPalette
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        local.selectionAction,
        { backgroundColor: pressed ? palette.border : palette.button },
        disabled ? local.selectionActionDisabled : null
      ]}
      onPress={onPress}
    >
      {icon}
      <Text style={[local.selectionActionText, { color: destructive ? '#d44a3a' : palette.text }]}>{label}</Text>
    </Pressable>
  )
}

// Tabs closed lately, newest first, each one tap from coming back.
function RecentlyClosedPanel ({
  items,
  palette,
  onBack,
  onClear,
  onReopen
}: {
  items: RecentlyClosedTab[]
  palette: BrowserTabsPalette
  onBack: () => void
  onClear: () => void
  onReopen: (key: string) => void
}) {
  const now = Date.now()
  return (
    <>
      <View style={[styles.browserTabsHeader, { borderBottomColor: palette.border }]}>
        <View style={local.panelTitleRow}>
          <Pressable
            accessibilityLabel='Back to tabs'
            accessibilityRole='button'
            hitSlop={8}
            style={[styles.browserTabsViewButton, { backgroundColor: palette.button }]}
            onPress={onBack}
          >
            <ChevronLeftIcon width={20} height={20} color={palette.text} />
          </Pressable>
          <Text style={[local.panelTitle, { color: palette.text }]}>Recently closed</Text>
        </View>
        {items.length > 0 && (
          <Pressable accessibilityRole='button' hitSlop={8} onPress={onClear}>
            <Text style={[local.clearText, { color: palette.text }]}>Clear</Text>
          </Pressable>
        )}
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        contentContainerStyle={local.closedList}
        ListEmptyComponent={(
          <Text style={[local.emptyText, { color: palette.mutedText }]}>
            Tabs you close show up here, so you can open them again.
          </Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`Open ${item.title} again`}
            accessibilityRole='button'
            style={({ pressed }) => [
              local.closedRow,
              { backgroundColor: pressed ? palette.button : palette.address, borderColor: palette.border }
            ]}
            onPress={() => onReopen(item.key)}
          >
            <View style={[styles.browserTabCardHeaderFallback, { backgroundColor: palette.button }]}>
              <Text style={[styles.browserTabCardHeaderFallbackText, { color: palette.text }]}>
                {Array.from(item.title || '?')[0]?.toUpperCase()}
              </Text>
            </View>
            <View style={local.closedCopy}>
              <Text numberOfLines={1} style={[local.closedTitle, { color: palette.text }]}>{item.title}</Text>
              <Text numberOfLines={1} style={[local.closedUrl, { color: palette.mutedText }]}>
                {formatClosedTabTime(item.closedAt, now)} · {item.url}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </>
  )
}

function SwipeableTabCard ({
  children,
  disabled = false,
  onClose,
  style
}: {
  children: ReactNode
  // While picking tabs, a sideways drag is not a close.
  disabled?: boolean
  onClose: () => void
  style: StyleProp<ViewStyle>
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !disabledRef.current && isHorizontalSwipe(gesture),
    // Claim the move before the card's own Pressable sees it, or a swipe that
    // starts on the preview reads as a press.
    onMoveShouldSetPanResponderCapture: (_, gesture) => !disabledRef.current && isHorizontalSwipe(gesture),
    // The FlatList asks for the gesture back as soon as the finger drifts
    // downward. Saying yes is what made a swipe take two or three tries.
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, gesture) => translateX.setValue(gesture.dx),
    onPanResponderRelease: (_, gesture) => {
      if (!shouldCloseOnRelease(gesture)) {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true
        }).start()
        return
      }

      Animated.timing(translateX, {
        duration: 160,
        toValue: gesture.dx < 0 ? -500 : 500,
        useNativeDriver: true
      }).start(({ finished }) => {
        if (!finished) return

        onCloseRef.current()
        // FlatList may recycle this cell when the final tab is replaced by Home.
        translateX.setValue(0)
      })
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true
      }).start()
    }
  })).current

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        style,
        {
          opacity: translateX.interpolate({
            inputRange: [-200, 0, 200],
            outputRange: [0.25, 1, 0.25],
            extrapolate: 'clamp'
          }),
          transform: [{ translateX }]
        }
      ]}
    >
      {children}
    </Animated.View>
  )
}

function TabFavicon ({
  favicon,
  label,
  palette,
  size
}: TabFaviconProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null)
  const faviconUri = typeof favicon === 'string' ? favicon : null
  const canRenderFavicon = Boolean(
    favicon && (faviconUri === null || faviconUri !== failedUri)
  )

  useEffect(() => {
    setFailedUri(null)
  }, [favicon])

  if (canRenderFavicon) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={faviconUri ? { uri: faviconUri } : favicon as ImageSourcePropType}
        style={size === 'header'
          ? styles.browserTabCardHeaderFavicon
          : styles.browserTabCardFavicon}
        onError={() => setFailedUri(faviconUri)}
      />
    )
  }

  if (size === 'preview') {
    return (
      <Text
        style={[styles.browserTabCardPreviewText, { color: palette.mutedText }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    )
  }

  return (
    <View style={[
      styles.browserTabCardHeaderFallback,
      { backgroundColor: palette.button }
    ]}>
      <Text style={[
        styles.browserTabCardHeaderFallbackText,
        { color: palette.text }
      ]}>
        {label.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  )
}

const local = StyleSheet.create({
  selectionHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 20
  },
  headerTextButton: {
    fontSize: 16,
    fontWeight: '700'
  },
  headerTextButtonStrong: {
    color: '#1f6fd1',
    fontWeight: '800'
  },
  selectMark: {
    borderWidth: 2
  },
  selectMarkOn: {
    backgroundColor: '#1f6fd1',
    borderColor: '#1f6fd1'
  },
  selectionBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  selectionAction: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 8
  },
  selectionActionDisabled: {
    opacity: 0.45
  },
  selectionActionText: {
    fontSize: 14,
    fontWeight: '700'
  },
  menu: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 10,
    paddingVertical: 6,
    position: 'absolute',
    right: 16,
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    top: 82,
    width: 250
  },
  menuItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16
  },
  menuText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600'
  },
  menuCount: {
    fontSize: 13,
    fontWeight: '700'
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: '900'
  },
  clearText: {
    fontSize: 15,
    fontWeight: '700'
  },
  closedList: {
    gap: 10,
    padding: 16
  },
  closedRow: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  closedCopy: {
    flex: 1,
    minWidth: 0
  },
  closedTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  closedUrl: {
    fontSize: 12,
    marginTop: 2
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 8,
    paddingVertical: 24,
    textAlign: 'center'
  }
})
