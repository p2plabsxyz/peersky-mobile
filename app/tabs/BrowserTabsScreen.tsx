import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  FlatList,
  Image,
  LayoutAnimation,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  type StyleProp,
  Text,
  UIManager,
  type ViewStyle,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { BrowserTabPreview } from './useBrowserTabPreviews'
import { styles } from '../styles'
import FireIcon from '../../assets/icons/bootstrap/fire.svg'
import GridIcon from '../../assets/icons/bootstrap/grid.svg'
import ListIcon from '../../assets/icons/bootstrap/list-ul.svg'
import PlusIcon from '../../assets/icons/bootstrap/plus-lg.svg'
import CloseIcon from '../../assets/icons/bootstrap/x-lg.svg'

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true)
}

type BrowserTabManagerItem = {
  favicon: string | null
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
  favicon: string | null
  label: string
  palette: BrowserTabsPalette
  size: 'header' | 'preview'
}

type BrowserTabsScreenProps = {
  items: BrowserTabManagerItem[]
  newTabDisabled: boolean
  palette: BrowserTabsPalette
  viewMode: 'grid' | 'list'
  visible: boolean
  onBurnTabs: () => void
  onClose: () => void
  onCloseAllTabs: () => void
  onCloseTab: (tabId: string) => void
  onNewTab: () => void
  onPreviewError: (tabId: string) => void
  onSwitchTab: (tabId: string) => void
  onToggleView: () => void
}

export function BrowserTabsScreen ({
  items,
  newTabDisabled,
  palette,
  viewMode,
  visible,
  onBurnTabs,
  onClose,
  onCloseAllTabs,
  onCloseTab,
  onNewTab,
  onPreviewError,
  onSwitchTab,
  onToggleView
}: BrowserTabsScreenProps) {
  const isList = viewMode === 'list'
  const closeTab = (tabId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    onCloseTab(tabId)
  }

  return (
    <Modal
      animationType='slide'
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.browserTabsScreen, { backgroundColor: palette.shell }]}
        edges={['top', 'left', 'right', 'bottom']}
      >
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
                ? <GridIcon width={20} height={20} color={palette.text} />
                : <ListIcon width={20} height={20} color={palette.text} />}
            </Pressable>
            <Pressable
              accessibilityLabel='Burn tabs and cached data'
              accessibilityRole='button'
              style={styles.browserTabsBurnButton}
              onPress={onBurnTabs}
            >
              <FireIcon width={20} height={20} color='#ffffff' />
            </Pressable>
            <Pressable
              accessibilityLabel='Close all tabs'
              accessibilityRole='button'
              style={[styles.browserTabsViewButton, { backgroundColor: palette.button }]}
              onPress={onCloseAllTabs}
            >
              <CloseIcon width={20} height={20} color={palette.text} />
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
              <PlusIcon width={20} height={20} color='#ffffff' />
            </Pressable>
          </View>
        </View>

        <FlatList
          key={`browser-tabs-${viewMode}`}
          data={items}
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
              onClose={() => closeTab(item.id)}
              style={[
                styles.browserTabCard,
                {
                  backgroundColor: palette.address,
                  borderColor: palette.border
                },
                isList ? styles.browserTabCardList : null,
                item.isActive ? styles.browserTabCardActive : null
              ]}
            >
              <Pressable
                accessibilityLabel={`Open ${item.label} tab`}
                accessibilityRole='button'
                accessibilityState={{ selected: item.isActive }}
                style={[
                  styles.browserTabCardBody,
                  isList ? styles.browserTabCardBodyList : null
                ]}
                onPress={() => onSwitchTab(item.id)}
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

              <Pressable
                accessibilityLabel={`Close ${item.label}`}
                accessibilityRole='button'
                hitSlop={8}
                style={[styles.browserTabCardClose, { backgroundColor: palette.button }]}
                onPress={() => closeTab(item.id)}
              >
                <CloseIcon width={16} height={16} color={palette.text} />
              </Pressable>
            </SwipeableTabCard>
          )}
        />
      </SafeAreaView>
    </Modal>
  )
}

function SwipeableTabCard ({
  children,
  onClose,
  style
}: {
  children: ReactNode
  onClose: () => void
  style: StyleProp<ViewStyle>
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy)
    ),
    onPanResponderMove: (_, gesture) => translateX.setValue(gesture.dx),
    onPanResponderRelease: (_, gesture) => {
      const shouldClose = Math.abs(gesture.dx) > 72 || (
        Math.abs(gesture.dx) > 24 && Math.abs(gesture.vx) > 0.7
      )

      if (!shouldClose) {
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
  const canRenderFavicon = Boolean(favicon && favicon !== failedUri)

  useEffect(() => {
    setFailedUri(null)
  }, [favicon])

  if (canRenderFavicon) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: favicon as string }}
        style={size === 'header'
          ? styles.browserTabCardHeaderFavicon
          : styles.browserTabCardFavicon}
        onError={() => setFailedUri(favicon)}
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
