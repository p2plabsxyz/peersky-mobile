import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ArrowUpLeftIcon from '../../assets/icons/bootstrap/arrow-up-left.svg'
import HistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import SearchIcon from '../../assets/icons/bootstrap/search.svg'
import type { BrowserHistoryItem } from './useBrowserHistory'

type BrowserPalette = {
  border: string
  button: string
  mutedText: string
  surface: string
  text: string
}

export type OneOffSearchEngine = {
  id: string
  title: string
}

/**
 * What the address bar offers while you type: pages from history, then what
 * the search engine suggests, then the other engines to search with just
 * this once.
 */
export function HistorySuggestions ({
  background,
  items,
  offset,
  palette,
  position,
  query = '',
  searches = [],
  searchEngines = [],
  onFill,
  onOpen,
  onSearch
}: {
  // The toolbar's own colour, not the generic surface. The two are meant to
  // read as one panel that opened, which they cannot do in two shades.
  background: string
  items: BrowserHistoryItem[]
  offset: number
  palette: BrowserPalette
  position: 'top' | 'bottom'
  // What is typed, for the engines below the list.
  query?: string
  searches?: string[]
  searchEngines?: OneOffSearchEngine[]
  // Puts a suggestion in the bar to keep typing from, without searching.
  onFill?: (text: string) => void
  onOpen: (url: string) => void
  // With no engine, the one chosen in Settings.
  onSearch?: (text: string, searchEngine?: string) => void
}) {
  const insets = useSafeAreaInsets()
  const typed = query.trim()
  const showEngines = typed.length > 0 && searchEngines.length > 0 && onSearch !== undefined
  if (items.length === 0 && searches.length === 0 && !showEngines) return null

  return (
    <View style={[
      styles.container,
      // The bar's measured height, in a stack with no padding of its own, so
      // the list lands exactly on the bar's edge. A percentage would be
      // resolved against a parent the keyboard is busy resizing.
      position === 'bottom' ? { bottom: offset } : { top: offset },
      position === 'bottom' ? styles.attachedBelow : styles.attachedAbove,
      {
        backgroundColor: background,
        // The hairline in the light border colour all but vanished on a white
        // page. The muted text colour, faded, shows on light and dark alike.
        borderColor: `${palette.mutedText}66`,
        // Padding, not a margin: the panel still reaches both screen edges
        // like the bar does, and only the rows step in, so a clock lines up
        // with where the address field starts rather than with the notch.
        paddingLeft: insets.left,
        paddingRight: insets.right
      }
    ]}>
      <ScrollView keyboardShouldPersistTaps='handled' style={styles.list}>
        {items.map((item) => (
          <Pressable
            key={item.url}
            accessibilityLabel={`Open history suggestion ${item.title}`}
            accessibilityRole='link'
            style={({ pressed }) => [styles.row, pressed ? { backgroundColor: palette.button } : null]}
            onPress={() => onOpen(item.url)}
          >
            <HistoryIcon width={17} height={17} color={palette.mutedText} />
            <View style={styles.copy}>
              <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{item.title}</Text>
              <Text numberOfLines={1} style={[styles.url, { color: palette.mutedText }]}>{item.url}</Text>
            </View>
          </Pressable>
        ))}
        {onSearch && searches.map((search) => (
          <View key={`search:${search}`} style={styles.searchRow}>
            <Pressable
              accessibilityLabel={`Search for ${search}`}
              accessibilityRole='button'
              style={({ pressed }) => [styles.row, styles.searchRowMain, pressed ? { backgroundColor: palette.button } : null]}
              onPress={() => onSearch(search)}
            >
              <SearchIcon width={16} height={16} color={palette.mutedText} />
              <Text numberOfLines={1} style={[styles.copy, styles.search, { color: palette.text }]}>{search}</Text>
            </Pressable>
            {onFill && (
              <Pressable
                accessibilityLabel={`Edit ${search} in the address bar`}
                accessibilityRole='button'
                hitSlop={6}
                style={({ pressed }) => [styles.fill, pressed ? { backgroundColor: palette.button } : null]}
                onPress={() => onFill(search)}
              >
                {/* Points at the bar, wherever the bar is. */}
                <ArrowUpLeftIcon
                  width={16}
                  height={16}
                  color={palette.mutedText}
                  style={position === 'bottom' ? styles.pointDown : null}
                />
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>
      {showEngines && (
        <View style={[styles.engines, { borderTopColor: `${palette.mutedText}33` }]}>
          <Text style={[styles.enginesLabel, { color: palette.mutedText }]}>Search with</Text>
          <ScrollView
            horizontal
            contentContainerStyle={styles.engineList}
            keyboardShouldPersistTaps='handled'
            showsHorizontalScrollIndicator={false}
          >
            {searchEngines.map((engine) => (
              <Pressable
                key={engine.id}
                accessibilityLabel={`Search for ${typed} with ${engine.title}`}
                accessibilityRole='button'
                style={({ pressed }) => [
                  styles.engine,
                  { borderColor: `${palette.mutedText}55` },
                  pressed ? { backgroundColor: palette.button } : null
                ]}
                onPress={() => onSearch(typed, engine.id)}
              >
                <Text numberOfLines={1} style={[styles.engineText, { color: palette.text }]}>{engine.title}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 10,
    elevation: 10,
    // Edge to edge, like the bar it opens from. Inset by twelve, with a border
    // all the way round, it read as a card that happened to be nearby.
    left: 0,
    maxHeight: 330,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    zIndex: 20
  },
  // Only the far edge is drawn. The edge meeting the bar, and both sides, are
  // the bar's own, so the two read as one surface that grew. A hairline: a
  // full point read as a heavy rule across the page.
  attachedBelow: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    // Above the bar, its shadow fell down onto the bar and drew a second line
    // where the two meet. It goes up onto the page instead.
    elevation: 0,
    shadowOffset: { width: 0, height: -4 }
  },
  attachedAbove: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0
  },
  // Shrinks to leave room for the engines, which stay in view.
  list: { flexGrow: 0, flexShrink: 1 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 54, paddingHorizontal: 14 },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  url: { fontSize: 12, marginTop: 2 },
  searchRow: { alignItems: 'center', flexDirection: 'row' },
  searchRowMain: { flex: 1, minHeight: 46 },
  search: { fontSize: 15 },
  fill: { alignItems: 'center', borderRadius: 8, height: 40, justifyContent: 'center', marginRight: 6, width: 44 },
  pointDown: { transform: [{ scaleY: -1 }] },
  engines: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 52,
    paddingLeft: 14
  },
  enginesLabel: { fontSize: 12, fontWeight: '600' },
  engineList: { alignItems: 'center', gap: 8, paddingRight: 14, paddingVertical: 8 },
  engine: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12
  },
  engineText: { fontSize: 13, fontWeight: '600' }
})
