import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import HistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import type { BrowserHistoryItem } from './useBrowserHistory'

type BrowserPalette = {
  border: string
  button: string
  mutedText: string
  surface: string
  text: string
}

export function HistorySuggestions ({
  background,
  items,
  offset,
  palette,
  position,
  onOpen
}: {
  // The toolbar's own colour, not the generic surface. The two are meant to
  // read as one panel that opened, which they cannot do in two shades.
  background: string
  items: BrowserHistoryItem[]
  offset: number
  palette: BrowserPalette
  position: 'top' | 'bottom'
  onOpen: (url: string) => void
}) {
  const insets = useSafeAreaInsets()
  if (items.length === 0) return null

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
      <ScrollView keyboardShouldPersistTaps='handled'>
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
      </ScrollView>
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
    maxHeight: 290,
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
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 54, paddingHorizontal: 14 },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  url: { fontSize: 12, marginTop: 2 }
})
