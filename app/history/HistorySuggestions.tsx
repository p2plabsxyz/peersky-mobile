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
  items,
  palette,
  position,
  onOpen
}: {
  items: BrowserHistoryItem[]
  palette: BrowserPalette
  position: 'top' | 'bottom'
  onOpen: (url: string) => void
}) {
  if (items.length === 0) return null

  return (
    <View style={[
      styles.container,
      position === 'bottom' ? styles.above : styles.below,
      { backgroundColor: palette.surface, borderColor: palette.border }
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
  above: { bottom: '100%', marginBottom: 8 },
  below: { marginTop: 8, top: '100%' },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 54, paddingHorizontal: 14 },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  url: { fontSize: 12, marginTop: 2 }
})
