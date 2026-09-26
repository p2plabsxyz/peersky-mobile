import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
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
  if (items.length === 0) return null

  return (
    <View style={[
      styles.container,
      // Measured off the toolbar rather than "bottom: 100%". A percentage is
      // resolved against a parent the keyboard is busy resizing, which is not
      // something to depend on for whether the list covers the address bar.
      //
      // Flush against the toolbar, with the touching edge left square and
      // unbordered, so the list reads as the address bar opening out rather
      // than a separate card floating above it.
      position === 'bottom' ? { bottom: offset } : { top: offset },
      position === 'bottom' ? styles.attachedBelow : styles.attachedAbove,
      { backgroundColor: background, borderColor: palette.border }
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
    borderWidth: 1,
    elevation: 10,
    left: 12,
    maxHeight: 290,
    overflow: 'hidden',
    position: 'absolute',
    right: 12,
    shadowColor: '#10131a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    zIndex: 20
  },
  // The edge that meets the toolbar.
  attachedBelow: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0
  },
  attachedAbove: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopWidth: 0
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 54, paddingHorizontal: 14 },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  url: { fontSize: 12, marginTop: 2 }
})
