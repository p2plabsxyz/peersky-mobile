import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View
} from 'react-native'
import ArrowLeftIcon from '../../assets/icons/bootstrap/arrow-left.svg'
import HistoryIcon from '../../assets/icons/bootstrap/clock-history.svg'
import TrashIcon from '../../assets/icons/bootstrap/trash.svg'
import { BROWSER_PALETTES } from '../browser-appearance.mjs'
import type { BrowserHistoryItem } from './useBrowserHistory'

type HistoryScreenProps = {
  error: string | null
  isDark: boolean
  isReady: boolean
  items: BrowserHistoryItem[]
  onClear: () => void
  onClose: () => void
  onOpen: (url: string) => void
  onRemove: (item: BrowserHistoryItem) => void
}

export function HistoryScreen ({
  error,
  isDark,
  isReady,
  items,
  onClear,
  onClose,
  onOpen,
  onRemove
}: HistoryScreenProps) {
  const palette = isDark ? BROWSER_PALETTES.dark : BROWSER_PALETTES.light

  function confirmClear () {
    Alert.alert('Clear browsing history?', 'This removes every saved history entry.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: onClear }
    ])
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.shell }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <Pressable
          accessibilityLabel='Close History'
          accessibilityRole='button'
          hitSlop={10}
          style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
          onPress={onClose}
        >
          <ArrowLeftIcon width={22} height={22} color={palette.text} />
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]}>History</Text>
        <Pressable
          accessibilityLabel='Clear browsing history'
          accessibilityRole='button'
          disabled={!isReady || items.length === 0}
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconButton,
            !isReady || items.length === 0 ? styles.disabled : null,
            pressed ? styles.pressed : null
          ]}
          onPress={confirmClear}
        >
          <TrashIcon width={21} height={21} color={palette.text} />
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!isReady
        ? (
          <View style={styles.empty}>
            <ActivityIndicator color={palette.accent} />
            <Text style={[styles.emptyText, { color: palette.mutedText }]}>Loading history...</Text>
          </View>
          )
        : items.length === 0
          ? (
            <View style={styles.empty}>
              <HistoryIcon width={30} height={30} color={palette.mutedText} />
              <Text style={[styles.emptyText, { color: palette.mutedText }]}>No browsing history yet.</Text>
            </View>
            )
          : (
            <FlatList
              data={items}
              keyExtractor={(item, index) => `${item.visitedAt}:${index}`}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <View style={[styles.row, { borderBottomColor: palette.border }]}>
                  <Pressable
                    accessibilityLabel={`Open ${item.title}`}
                    accessibilityRole='link'
                    style={({ pressed }) => [styles.rowContent, pressed ? styles.pressed : null]}
                    onPress={() => onOpen(item.url)}
                  >
                    <Text numberOfLines={1} style={[styles.itemTitle, { color: palette.text }]}>{item.title}</Text>
                    <Text numberOfLines={1} style={[styles.itemUrl, { color: palette.mutedText }]}>{item.url}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Remove ${item.title} from history`}
                    accessibilityRole='button'
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeButton, pressed ? styles.pressed : null]}
                    onPress={() => onRemove(item)}
                  >
                    <TrashIcon width={19} height={19} color='#b83250' />
                  </Pressable>
                </View>
              )}
            />
            )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: 14
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  title: { flex: 1, fontSize: 20, fontWeight: '700', marginHorizontal: 10 },
  errorBanner: { backgroundColor: '#5a2531', margin: 14, padding: 12, borderRadius: 8 },
  errorText: { color: '#ffd9e1', fontSize: 14 },
  empty: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 15 },
  list: { paddingHorizontal: 16 },
  row: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 76 },
  rowContent: { flex: 1, gap: 5, paddingHorizontal: 8, paddingVertical: 14 },
  itemTitle: { fontSize: 16, fontWeight: '600' },
  itemUrl: { fontSize: 13 },
  removeButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 }
})
