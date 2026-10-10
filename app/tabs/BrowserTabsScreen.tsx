import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  FlatList,
  Image,
  type ImageSourcePropType,
  LayoutAnimation,
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
import ChevronRightIcon from '../../assets/icons/bootstrap/chevron-right.svg'
import ClockHistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import CopyIcon from '../../assets/icons/bootstrap/copy.svg'
import FireIcon from '../../assets/icons/bootstrap/fire.svg'
import GridIcon from '../../assets/icons/bootstrap/grid.svg'
import ListIcon from '../../assets/icons/bootstrap/list-ul.svg'
import MoreIcon from '../../assets/icons/bootstrap/three-dots-vertical.svg'
import PlusIcon from '../../assets/icons/bootstrap/plus-lg.svg'
import ShareIcon from '../../assets/icons/bootstrap/arrow-bar-up.svg'
import CloseIcon from '../../assets/icons/bootstrap/x-lg.svg'
import { getTabDropIndex, isHorizontalSwipe, shouldCloseOnRelease } from './tab-swipe.mjs'
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
  // Not opened for two weeks. See isInactiveBrowserTab.
  isInactive: boolean
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
  // Moves a tab to where another one is, as dragging it there does.
  onMoveTab: (tabId: string, toTabId: string) => void
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
  onMoveTab,
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
  // Tabs not opened for two weeks sit in a group of their own at the top,
  // folded away, as in Firefox. Picking tabs shows them all in the grid.
  const inactiveItems = items.filter((item) => item.isInactive)
  const gridItems = selecting ? items : items.filter((item) => !item.isInactive)
  const [inactiveOpen, setInactiveOpen] = useState(false)
  // Pressing and holding a tab picks it up. Dragged, it moves there; let go
  // where it is, and it starts picking tabs instead.
  const [dragArmedId, setDragArmedId] = useState<string | null>(null)
  const dragArmedIdRef = useRef<string | null>(null)
  dragArmedIdRef.current = dragArmedId
  const draggingRef = useRef(false)
  const armedIndex = dragArmedId ? gridItems.findIndex((entry) => entry.id === dragArmedId) : -1
  const liftedRow = armedIndex < 0 ? -1 : Math.floor(armedIndex / (viewMode === 'list' ? 1 : 2))

  function dropTab (item: BrowserTabManagerItem, gesture: { dx: number, dy: number }, size: { width: number, height: number }) {
    draggingRef.current = false
    setDragArmedId(null)
    const from = gridItems.findIndex((entry) => entry.id === item.id)
    const to = getTabDropIndex({
      from,
      dx: gesture.dx,
      dy: gesture.dy,
      width: size.width,
      height: size.height,
      columns: isList ? 1 : 2,
      count: gridItems.length
    })
    const target = gridItems[to]
    if (from < 0 || !target || target.id === item.id) return
    LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'))
    onMoveTab(item.id, target.id)
  }

  function closeInactive () {
    const keys = onCloseTabs(inactiveItems.map((item) => item.id))
    setInactiveOpen(false)
    if (keys.length === 0) return
    setToast({
      id: Date.now(),
      message: keys.length === 1 ? 'Inactive tab closed' : `${keys.length} inactive tabs closed`,
      actionLabel: 'Undo',
      onAction: () => onReopenClosedTabs(keys)
    })
  }

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
    setDragArmedId(null)
  }, [visible])

  // Tabs stay in the order they were opened, newest last, as in Chrome and
  // Safari, and the screen opens on the tab you are on. A long list used to
  // open at the oldest tab, which looked like the newest had gone missing.
  const listRef = useRef<FlatList<BrowserTabManagerItem>>(null)
  const scrolledToActiveRef = useRef(false)
  const scrollRetriesRef = useRef(0)
  const activeIndex = gridItems.findIndex((item) => item.isActive)
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

        <LiftedRowContext.Provider value={liftedRow}>
        <FlatList
          ref={listRef}
          key={`browser-tabs-${viewMode}`}
          data={gridItems}
          ListHeaderComponent={!selecting && inactiveItems.length > 0
            ? (
              <InactiveTabs
                items={inactiveItems}
                open={inactiveOpen}
                palette={palette}
                onCloseAll={closeInactive}
                onCloseTab={closeTab}
                onOpenTab={onSwitchTab}
                onToggle={() => setInactiveOpen((open) => !open)}
              />
              )
            : null}
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
          // A picked-up card moves with the finger, not the list under it, and
          // its row draws over the rows it is dragged across.
          scrollEnabled={dragArmedId === null}
          CellRendererComponent={TabRow}
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
              armed={dragArmedId === item.id}
              disabled={selecting}
              onClose={() => closeTab(item.id)}
              onDragStart={() => { draggingRef.current = true }}
              onDrop={(gesture, size) => dropTab(item, gesture, size)}
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
                accessibilityHint={selecting ? undefined : 'Press and hold to move it, or to select several tabs'}
                accessibilityActions={selecting ? undefined : [{ name: 'longpress', label: 'Select several tabs' }]}
                onAccessibilityAction={() => {
                  if (!selecting) setSelected(new Set([item.id]))
                }}
                delayLongPress={350}
                style={[
                  styles.browserTabCardBody,
                  isList ? styles.browserTabCardBodyList : null
                ]}
                onLongPress={() => {
                  if (selecting) return
                  setMenuOpen(false)
                  draggingRef.current = false
                  setDragArmedId(item.id)
                }}
                onPressOut={() => {
                  // Let go without dragging: pick tabs, starting with this one.
                  // After the drag gets the touch, if it does, which happens
                  // just after this press ends.
                  setTimeout(() => {
                    if (dragArmedIdRef.current !== item.id || draggingRef.current) return
                    setDragArmedId(null)
                    setSelected(new Set([item.id]))
                  }, 0)
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
        </LiftedRowContext.Provider>
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

// The row of the tab being dragged, so that row draws above the rest. Rows are
// separate views in the list, painted in order, so a card dragged downward went
// under the next row without it.
const LiftedRowContext = createContext(-1)

// The same component every render: a new one each time would rebuild every
// card, and drop a drag in the middle of it.
function TabRow ({ children, index, style, ...props }: { children?: ReactNode, index: number, style?: StyleProp<ViewStyle> }) {
  const liftedRow = useContext(LiftedRowContext)
  return (
    <View {...props} style={[style, liftedRow === index ? local.liftedRow : null]}>
      {children}
    </View>
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

// The group of tabs not opened for two weeks, folded until asked for.
function InactiveTabs ({
  items,
  open,
  palette,
  onCloseAll,
  onCloseTab,
  onOpenTab,
  onToggle
}: {
  items: BrowserTabManagerItem[]
  open: boolean
  palette: BrowserTabsPalette
  onCloseAll: () => void
  onCloseTab: (tabId: string) => void
  onOpenTab: (tabId: string) => void
  onToggle: () => void
}) {
  return (
    <View style={[local.inactiveBox, { backgroundColor: palette.address, borderColor: palette.border }]}>
      <Pressable
        accessibilityRole='button'
        accessibilityState={{ expanded: open }}
        style={local.inactiveHeader}
        onPress={onToggle}
      >
        <View style={local.inactiveHeaderCopy}>
          <Text style={[local.inactiveTitle, { color: palette.text }]}>Inactive tabs ({items.length})</Text>
          <Text style={[local.inactiveHint, { color: palette.mutedText }]}>Not opened in two weeks</Text>
        </View>
        <ChevronRightIcon
          width={16}
          height={16}
          color={palette.mutedText}
          style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
        />
      </Pressable>
      {open && (
        <>
          {items.map((item) => (
            <View key={item.id} style={[local.inactiveRow, { borderTopColor: palette.border }]}>
              <Pressable
                accessibilityLabel={`Open ${item.label} tab`}
                accessibilityRole='button'
                style={local.inactiveRowBody}
                onPress={() => onOpenTab(item.id)}
              >
                <TabFavicon favicon={item.favicon} label={item.label} palette={palette} size='header' />
                <Text numberOfLines={1} style={[local.inactiveRowTitle, { color: palette.text }]}>{item.label}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Close ${item.label}`}
                accessibilityRole='button'
                hitSlop={8}
                style={[styles.browserTabCardClose, local.inactiveRowClose, { backgroundColor: palette.button }]}
                onPress={() => onCloseTab(item.id)}
              >
                <CloseIcon width={15} height={15} color={palette.text} />
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole='button'
            style={({ pressed }) => [
              local.inactiveCloseAll,
              { borderTopColor: palette.border },
              pressed ? { backgroundColor: palette.button } : null
            ]}
            onPress={onCloseAll}
          >
            <Text style={local.inactiveCloseAllText}>Close all inactive tabs</Text>
          </Pressable>
        </>
      )}
    </View>
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
  armed = false,
  children,
  disabled = false,
  onClose,
  onDragStart,
  onDrop,
  style
}: {
  // Picked up by a long press: the next move drags it.
  armed?: boolean
  children: ReactNode
  // While picking tabs, a sideways drag is not a close.
  disabled?: boolean
  onClose: () => void
  onDragStart?: () => void
  onDrop?: (gesture: { dx: number, dy: number }, size: { width: number, height: number }) => void
  style: StyleProp<ViewStyle>
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const dragX = useRef(new Animated.Value(0)).current
  const dragY = useRef(new Animated.Value(0)).current
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onDragStartRef = useRef(onDragStart)
  onDragStartRef.current = onDragStart
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const armedRef = useRef(armed)
  armedRef.current = armed
  const draggingRef = useRef(false)
  const sizeRef = useRef({ width: 0, height: 0 })

  useEffect(() => {
    if (armed) return
    dragX.setValue(0)
    dragY.setValue(0)
  }, [armed, dragX, dragY])

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => armedRef.current || (!disabledRef.current && isHorizontalSwipe(gesture)),
    // Claim the move before the card's own Pressable sees it, or a swipe that
    // starts on the preview reads as a press.
    onMoveShouldSetPanResponderCapture: (_, gesture) => armedRef.current || (!disabledRef.current && isHorizontalSwipe(gesture)),
    // The FlatList asks for the gesture back as soon as the finger drifts
    // downward. Saying yes is what made a swipe take two or three tries.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      draggingRef.current = armedRef.current
      if (draggingRef.current) onDragStartRef.current?.()
    },
    onPanResponderMove: (_, gesture) => {
      if (draggingRef.current) {
        dragX.setValue(gesture.dx)
        dragY.setValue(gesture.dy)
        return
      }
      translateX.setValue(gesture.dx)
    },
    onPanResponderRelease: (_, gesture) => {
      if (draggingRef.current) {
        draggingRef.current = false
        onDropRef.current?.({ dx: gesture.dx, dy: gesture.dy }, sizeRef.current)
        return
      }
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
      if (draggingRef.current) {
        draggingRef.current = false
        onDropRef.current?.({ dx: 0, dy: 0 }, sizeRef.current)
        return
      }
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true
      }).start()
    }
  })).current

  return (
    <Animated.View
      {...panResponder.panHandlers}
      onLayout={(event) => {
        sizeRef.current = {
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height
        }
      }}
      style={[
        style,
        armed ? local.liftedCard : null,
        {
          opacity: translateX.interpolate({
            inputRange: [-200, 0, 200],
            outputRange: [0.25, 1, 0.25],
            extrapolate: 'clamp'
          }),
          transform: [
            { translateX: Animated.add(translateX, dragX) },
            { translateY: dragY },
            { scale: armed ? 1.04 : 1 }
          ]
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
  liftedRow: {
    elevation: 12,
    zIndex: 10
  },
  liftedCard: {
    elevation: 12,
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 18
  },
  inactiveBox: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden'
  },
  inactiveHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  inactiveHeaderCopy: {
    flex: 1
  },
  inactiveTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  inactiveHint: {
    fontSize: 12,
    marginTop: 2
  },
  inactiveRow: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 52,
    paddingLeft: 16,
    paddingRight: 12
  },
  inactiveRowBody: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52
  },
  inactiveRowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600'
  },
  inactiveRowClose: {
    position: 'relative',
    right: 0,
    top: 0
  },
  inactiveCloseAll: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 50
  },
  inactiveCloseAllText: {
    color: '#d44a3a',
    fontSize: 14,
    fontWeight: '700'
  },
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
